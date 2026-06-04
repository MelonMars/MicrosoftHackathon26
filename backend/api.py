import os
import json
import asyncio
from typing import Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from mp_api.client import MPRester
from fastapi.middleware.cors import CORSMiddleware

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
class MaterialProblemRequest(BaseModel):
    problem: str
    constraints: Optional[str] = ""
    targetProperties: Optional[str] = ""

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