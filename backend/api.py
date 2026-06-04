import os
from typing import List, Optional

import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from mp_api.client import MPRester
from pydantic import BaseModel, Field

app = FastAPI(
    title="Gnome Materials API",
    description="An API to fetch stable materials matching specific elements from the Materials Project.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SiteModel(BaseModel):
    species: str = Field(..., description="The chemical element symbol (e.g., 'Li')")
    abc: List[float] = Field(..., description="Fractional coordinates [a, b, c]")

class MaterialResponse(BaseModel):
    id: str
    formula: str
    bandGap: float
    lattice: List[List[float]] = Field(..., description="3x3 matrix representing the lattice vectors")
    sites: List[SiteModel]

@app.get("/materials", response_model=List[MaterialResponse])
def get_gnome_materials(
    elements: List[str] = Query(default=["Li", "O"], description="List of elements to search for"),
    max_energy_above_hull: float = Query(default=0.05, description="Maximum energy above hull in eV/atom"),
    api_key: Optional[str] = Query(default=None, description="Optional MP API key. Defaults to MP_API_KEY env var if not provided.")
):
    mp_api_key = api_key or os.getenv("MP_API_KEY")
    
    if not mp_api_key:
        raise HTTPException(
            status_code=400, 
            detail="Materials Project API key is missing. Provide it via the 'api_key' query parameter or set the MP_API_KEY environment variable."
        )

    try:
        with MPRester(mp_api_key) as mpr:
            docs = mpr.materials.summary.search(
                elements=elements,
                energy_above_hull=(0, max_energy_above_hull),
                fields=["material_id", "formula_pretty", "structure", "band_gap"]
            )
            
            results = []
            for doc in docs:
                structure = doc.structure
                
                lattice_matrix = structure.lattice.matrix.tolist()
                
                sites = [
                    {
                        "species": str(site.specie.symbol), 
                        "abc": list(site.frac_coords)
                    }
                    for site in structure
                ]
                
                results.append({
                    "id": str(doc.material_id),
                    "formula": doc.formula_pretty,
                    "bandGap": float(doc.band_gap),
                    "lattice": lattice_matrix,
                    "sites": sites
                })
                
            return results

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Materials Project API error: {str(e)}")