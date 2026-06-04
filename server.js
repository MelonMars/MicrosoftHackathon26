import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const app = express();
const port = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/gnome", (req, res) => {
  const problem = (req.body?.problem || "").toString().trim();
  const constraints = (req.body?.constraints || "").toString().trim();
  const targetProperties = (req.body?.targetProperties || "").toString().trim();

  if (!problem) {
    return res.status(400).json({ error: "problem is required" });
  }

  const materialSystem = "bio-based cellulose + PHA composite";
  const proposal = [
    "Use a cellulose-rich fiber fraction for stiffness and compostability.",
    "Blend with PHA to improve water resistance and heat tolerance.",
    "Add food-safe plasticizers to tune flexibility for thin-walled packaging.",
  ];
  const testingPlan = [
    "Barrier tests: water vapor transmission and grease resistance.",
    "Mechanical tests: flexural strength and drop impact.",
    "End-of-life tests: industrial compostability and recyclability screening.",
  ];
  const manufacturingOverview = [
    "Source and pre-process fibers (washing, drying, size reduction).",
    "Compound fibers with PHA in a twin-screw extrusion process.",
    "Form sheets or films and thermoform into packaging geometry.",
    "Condition and validate quality against target properties.",
  ];

  res.json({
    model: "DeepMind Gnome (mock integration)",
    problem,
    constraints,
    targetProperties,
    materialSystem,
    proposal,
    testingPlan,
    manufacturingOverview,
    safetyNotes:
      "High-level guidance only. Follow local regulations and material safety data sheets.",
  });
});

app.get("/api/papers", async (req, res) => {
  const query = (req.query.query || "").toString().trim();
  if (!query) {
    return res.status(400).json({ error: "query is required" });
  }

  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", "8");
  url.searchParams.set(
    "fields",
    "title,authors,year,abstract,url,venue,citationCount"
  );

  try {
    const response = await fetch(url.toString(), {
      headers: { "User-Agent": "material-gnome-site" },
    });

    if (!response.ok) {
      const details = await response.text();
      return res.status(502).json({
        error: "paper_search_failed",
        details: details.slice(0, 600),
      });
    }

    const data = await response.json();
    const papers = (data.data || []).map((paper) => ({
      title: paper.title,
      year: paper.year,
      venue: paper.venue,
      citationCount: paper.citationCount,
      url: paper.url,
      abstract: paper.abstract,
      authors: (paper.authors || []).map((author) => author.name).slice(0, 6),
    }));

    return res.json({ total: data.total || 0, papers });
  } catch (error) {
    return res.status(502).json({
      error: "paper_search_failed",
      details: error?.message || "Unknown error",
    });
  }
});

app.get("/api/recipe", (req, res) => {
  res.json({
    material: "Cellulose + PHA compostable packaging",
    steps: [
      "Define performance targets (barrier, stiffness, compostability).",
      "Select fiber grades and PHA resin compatible with food contact.",
      "Compound the blend and validate dispersion at pilot scale.",
      "Thermoform into final packaging geometry and run QA tests.",
    ],
    compliance:
      "Ensure regulatory compliance (food-contact, compostability, and labeling).",
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
