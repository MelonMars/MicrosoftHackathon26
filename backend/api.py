import os
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field
from mp_api.client import MPRester

app = FastAPI()

# 1. Define the incoming request body model matching your React frontend keys
class MaterialProblemRequest(BaseModel):
    problem: str = Field(..., description="The material problem statement from the user")
    constraints: Optional[str] = Field(default="", description="Comma-separated constraints")
    targetProperties: Optional[str] = Field(default="", description="Target performance properties")

class SiteModel(BaseModel):
    species: str = Field(..., description="The chemical element symbol (e.g., 'Li')")
    abc: List[float] = Field(..., description="Fractional coordinates [a, b, c]")

class MaterialResponse(BaseModel):
    id: str = Field(..., description="The unique Materials Project ID")
    formula: str = Field(..., description="The pretty/reduced chemical formula")
    bandGap: float = Field(..., description="The band gap energy in eV")
    lattice: List[List[float]] = Field(..., description="3x3 matrix representing the lattice vectors")
    sites: List[SiteModel] = Field(..., description="List of atomic site positions and species")

@app.post("/materials", response_model=List[MaterialResponse]) # Assumes MaterialResponse is defined above
def get_gnome_materials(
    payload: MaterialProblemRequest, 
    api_key: Optional[str] = Query(default=None, description="Optional MP API key")
):
    mp_api_key = api_key or os.getenv("MP_API_KEY")
    
    if not mp_api_key:
        raise HTTPException(
            status_code=400, 
            detail="Materials Project API key is missing. Provide it via the 'api_key' query parameter or set the MP_API_KEY environment variable."
        )

    # 💡 ARCHITECTURE NOTE:
    # Your frontend sends natural language strings (like payload.problem = "Replace petroleum clamshells...").
    # The Materials Project API requires strict chemical elements (like ["Li", "O"]). 
    # For now, we extract hardcoded/fallback search parameters so the API call doesn't crash.
    elements = ["C", "O", "H"]  # Fallback elements common to organic/compostable packaging materials
    max_energy_above_hull = 0.05

    try:
        with MPRester(mp_api_key) as mpr:
            # Query the Materials Project API
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