import os
import json
import asyncio
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from mp_api.client import MPRester
from fastapi.middleware.cors import CORSMiddleware
from openai import AsyncOpenAI
from pydantic import BaseModel, Field
from typing import List
import logging
import random

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

# --- Modified Helper Function ---
# It now accepts the dynamically parsed elements instead of a hardcoded list
def fetch_mp_data(api_key: str, elements: List[str]):
    max_energy_above_hull = 0.05
    with MPRester(api_key) as mpr:
        return mpr.materials.summary.search(
            elements=elements,
            energy_above_hull=(0, max_energy_above_hull),
            fields=["material_id", "formula_pretty", "structure", "band_gap"]
        )

# --- New Helper Function to Parse Plaintext via LLM ---
# @app.post("/materials")
# async def get_gnome_materials_stream(
#     payload: MaterialProblemRequest, 
#     api_key: Optional[str] = Query(default=None)
# ):
#     mp_api_key = api_key or os.getenv("MP_API_KEY")
#     if not mp_api_key:
#         raise HTTPException(status_code=400, detail="Missing MP_API_KEY")

#     async def event_generator():
#         try:
#             # 1. Parse plaintext problem string into search criteria (Elements)
#             # Combine problem, constraints, and targets to give the LLM full context
#             full_context = f"{payload.problem} {payload.constraints} {payload.targetProperties}"
#             elements = await parse_elements_from_problem(full_context)

#             # 2. Query Materials Project using the parsed criteria
#             loop = asyncio.get_event_loop()
#             docs = await loop.run_in_executor(
#                 None, 
#                 fetch_mp_data, 
#                 mp_api_key, 
#                 elements
#             )

#             if not docs:
#                 yield f"data: {json.dumps({'message': f'No materials found containing elements: {elements}'})}\n\n"
#                 return
#             for idx, doc in enumerate(docs):
#                 structure = doc.structure
#                 material_item = {
#                     "id": str(doc.material_id),
#                     "formula": doc.formula_pretty,
#                     "bandGap": float(doc.band_gap) if doc.band_gap is not None else 0.0,
#                     "lattice": structure.lattice.matrix.tolist(),
#                     "sites": [
#                         {"species": str(site.specie.symbol), "abc": list(site.frac_coords)}
#                         for site in structure
#                     ]
#                 }
#                 yield f"data: {json.dumps(material_item)}\n\n"
#                 await asyncio.sleep(0.01) 
#         except Exception as e:
#             yield f"data: {json.dumps({'error': str(e)})}\n\n"

#     return StreamingResponse(event_generator(), media_type="text/event-stream")

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
            loop = asyncio.get_event_loop()
            docs = await loop.run_in_executor(
                None, 
                fetch_mp_data, 
                mp_api_key, 
                ["O", "Si", "H"]
            )

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

async def parse_elements_from_problem(problem_text: str) -> List[str]:
    """Uses the local LLM with structured outputs to extract element symbols."""
    try:
        # Note the use of .beta.chat.completions.parse instead of .chat.completions.create
        response = await local_llm_client.beta.chat.completions.parse(
            model="openai/gpt-oss-20b",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a chemistry parser. Extract all chemical elements mentioned "
                        "or implied by the user's problem statement."
                    )
                },
                {"role": "user", "content": f"Problem: {problem_text}"}
            ],
            response_format=ElementParserResponse,  # Enforce the Pydantic schema here
        )
        
        # The SDK automatically parses the response into your Pydantic model
        parsed_response = response.choices[0].message.parsed
        
        if parsed_response and parsed_response.elements:
            return parsed_response.elements
            
        return ["Si", "O"] # Fallback if empty
        
    except Exception as e:
        logging.error(f"Structured output parsing failed. Error: {e}")
        # Secure fallback so your streaming loop doesn't crash entirely
        return ["Si", "O"]
    
@app.post("/chat")
async def chat_with_material_reasoner(payload: ChatRequest):
    material_search = ""
    async def chat_generator():
        try:
            material_context_str = "No material selected yet."
            if payload.currentMaterial:
                material_context_str = (
                    f"Formula: {payload.currentMaterial.formula}, "
                    f"Materials Project ID: {payload.currentMaterial.id}, "
                    f"Electronic Band Gap: {payload.currentMaterial.bandGap} eV, "
                    f"Total Unit Cell Atoms: {payload.currentMaterial.sites_count}"
                )
            if payload.searchTerm:
                material_search = payload.searchTerm

            system_instruction = {
                "role": "system",
                "content": (
                    "You are an expert AI materials science reasoning assistant at Gnome Materials Studio.\n"
                    "Help the user analyze, interpret, and understand why certain crystal lattice configurations work.\n"
                    f"CURRENT MATERIAL CONTEXT USER IS LOOKING AT: {material_context_str}\n"
                    f"User searched this material while looking for: {material_search}. Make sure to reinforce why it is a good idea.\n"
                    "Do NOT use markdown, tables, bolding, &c. Just output plain text."
                )
            }

            formatted_messages = [system_instruction]
            
            for msg in payload.messages:
                if not msg.content.strip():
                    continue
                    
                formatted_messages.append({
                    "role": msg.role,
                    "content": msg.content
                })

            response_stream = await local_llm_client.chat.completions.create(
                model="openai/gpt-oss-20b", 
                messages=formatted_messages,
                stream=True
            )

            async for chunk in response_stream:
                token = chunk.choices[0].delta.content
                if token:
                    yield f"data: {json.dumps({'text': token})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(chat_generator(), media_type="text/event-stream")