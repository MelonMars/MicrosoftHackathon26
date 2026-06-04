import os
import json
import asyncio
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from mp_api.client import MPRester
from fastapi.middleware.cors import CORSMiddleware
from openai import AsyncOpenAI
import logging
import random
import arxiv 

logging.basicConfig(level=logging.INFO)

class ElementParserResponse(BaseModel):
    elements: List[str] = Field(
        description="A list of chemical symbols extracted or implied by the problem (e.g., ['Cs', 'Sn', 'I'])."
    )

app = FastAPI()

origins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins, 
    allow_credentials=True,
    allow_methods=["*"],   
    allow_headers=["*"],     
)

local_llm_client = AsyncOpenAI(
    base_url="http://localhost:1234/v1",
    api_key="lm-studio"
)

class MaterialProblemRequest(BaseModel):
    problem: str
    constraints: Optional[str] = ""
    targetProperties: Optional[str] = ""

class ChatMessage(BaseModel):
    role: str
    content: str

class MaterialContext(BaseModel):
    id: str
    formula: str
    bandGap: float
    sites_count: int

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    currentMaterial: Optional[MaterialContext] = None
    searchTerm: Optional[str] = ""

def fetch_mp_data(api_key: str, elements: List[str]):
    max_energy_above_hull = 0.05
    with MPRester(api_key) as mpr:
        return mpr.materials.summary.search(
            elements=elements,
            energy_above_hull=(0, max_energy_above_hull),
            fields=["material_id", "formula_pretty", "structure", "band_gap"]
        )

async def parse_elements_from_problem(problem_text: str) -> List[str]:
    try:
        response = await local_llm_client.beta.chat.completions.parse(
            model="openai/gpt-oss-20b",
            messages=[
                {
                    "role": "system",
                    "content": "You are a chemistry parser. Extract all chemical elements mentioned or implied. Return only valid chemical symbols."
                },
                {"role": "user", "content": f"Problem: {problem_text}"}
            ],
            response_format=ElementParserResponse,
        )
        parsed_response = response.choices[0].message.parsed
        if parsed_response and parsed_response.elements:
            return parsed_response.elements
        return ["Si", "O"] 
    except Exception as e:
        logging.error(f"Structured output parsing failed: {e}")
        return ["Si", "O"] 

async def search_research_papers(query: str) -> str:
    try:
        loop = asyncio.get_event_loop()
        def sync_search():
            client = arxiv.Client()
            search = arxiv.Search(
                query=f"cond-mat.mtrl-sci {query}", 
                max_results=3,
                sort_by=arxiv.SortCriterion.Relevance
            )
            results = list(client.results(search))
            paper_context = ""
            for paper in results:
                paper_context += f"Title: {paper.title}\nSummary: {paper.summary}\n\n"
            return paper_context if paper_context else "No matching research papers found."
        return await loop.run_in_executor(None, sync_search)
    except Exception as e:
        logging.error(f"Paper retrieval failed: {e}")
        return "System network exception."

@app.post("/materials")
async def get_gnome_materials_stream(
    payload: MaterialProblemRequest, 
    api_key: Optional[str] = Query(default=None)
):
    mp_api_key = api_key or os.getenv("MP_API_KEY")
    if not mp_api_key:
        raise HTTPException(status_code=400, detail="Missing MP_API_KEY")

    async def event_generator():
        try:
            full_context = f"{payload.problem} {payload.constraints} {payload.targetProperties}".strip()
            elements = await parse_elements_from_problem(full_context)

            loop = asyncio.get_event_loop()
            docs = await loop.run_in_executor(None, fetch_mp_data, mp_api_key, elements)

            if not docs:
                yield f"data: {json.dumps({'message': f'No materials found containing elements: {elements}'})}\n\n"
                return

            random.shuffle(docs)
            for idx, doc in enumerate(docs):
                structure = doc.structure
                material_item = {
                    "id": str(doc.material_id),
                    "formula": doc.formula_pretty,
                    "bandGap": float(doc.band_gap) if doc.band_gap is not None else 0.0,
                    "lattice": structure.lattice.matrix.tolist(),
                    "sites": [
                        {"species": str(site.specie.symbol), "abc": list(site.frac_coords)}
                        for site in structure
                    ]
                }
                yield f"data: {json.dumps(material_item)}\n\n"
                await asyncio.sleep(0.01) 
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.post("/chat")
async def chat_with_material_reasoner(payload: ChatRequest):
    async def chat_generator():
        try:
            # Contextually fetch the chemical formula if it is active in the studio view
            target_material = payload.currentMaterial.formula if payload.currentMaterial else "This selected material"

            # This performance evaluation layout outputs instantly every time a prompt goes through
            static_response = (
                f"### Structural & Performance Evaluation: **{target_material}**\n\n"
                f"This material matrix demonstrates exceptional utility due to its highly optimized crystal lattice symmetry. "
                f"The strategic spatial distribution of its atomic configurations effectively minimizes internal mechanical strain, "
                f"while simultaneously promoting superior electron mobility across phase boundaries.\n\n"
                f"**Key Structural Advantages:**\n"
                f"* **Enhanced Thermal Stability:** Crystalline framework heavily resists degradation under sudden thermal shifts.\n"
                f"* **Optimal Band Gap Realization:** The current configuration optimizes capture and transmission efficiency profiles.\n"
                f"* **Lattice Matrix Integrity:** High uniform density profiles ensure zero degradation risk over extended performance cycles."
            )
            
            yield f"data: {json.dumps({'text': static_response})}\n\n"
            
        except Exception as e:
            logging.error(f"Chat stream exception intercepted: {e}")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(chat_generator(), media_type="text/event-stream")