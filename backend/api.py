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

def fetch_mp_data(api_key: str):
    elements = ["C", "O", "H"]
    max_energy_above_hull = 0.05
    with MPRester(api_key) as mpr:
        return mpr.materials.summary.search(
            elements=elements,
            energy_above_hull=(0, max_energy_above_hull),
            fields=["material_id", "formula_pretty", "structure", "band_gap"]
        )

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
            docs = await loop.run_in_executor(None, fetch_mp_data, mp_api_key)

            for idx, doc in enumerate(docs):
                structure = doc.structure
                material_item = {
                    "id": str(doc.material_id),
                    "formula": doc.formula_pretty,
                    "bandGap": float(doc.band_gap),
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


# --- CONNECTED TO LM STUDIO ---
@app.post("/chat")
async def chat_with_material_reasoner(payload: ChatRequest):
    async def chat_generator():
        try:
            # Format the material context if it exists
            material_context_str = "No material selected yet."
            if payload.currentMaterial:
                material_context_str = (
                    f"Formula: {payload.currentMaterial.formula}, "
                    f"Materials Project ID: {payload.currentMaterial.id}, "
                    f"Electronic Band Gap: {payload.currentMaterial.bandGap} eV, "
                    f"Total Unit Cell Atoms: {payload.currentMaterial.sites_count}"
                )

            # Injected system instruction guiding the local model
            system_instruction = {
                "role": "system",
                "content": (
                    "You are an expert AI materials science reasoning assistant at Gnome Materials Studio.\n"
                    "Help the user analyze, interpret, and understand why certain crystal lattice configurations work, "
                    "their potential stability traits, application profiles, and synthesizability.\n"
                    f"CURRENT MATERIAL CONTEXT USER IS LOOKING AT: {material_context_str}"
                )
            }

            formatted_messages = [system_instruction]
            for msg in payload.messages:
                formatted_messages.append({"role": msg.role, "role": msg.role, "content": msg.content})

            response_stream = await local_llm_client.chat.completions.create(
                model="local-model", 
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