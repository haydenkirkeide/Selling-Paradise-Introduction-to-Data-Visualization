from pathlib import Path
 
# Import backend info
from flask import Flask, jsonify
from flask_cors import CORS

# Import analytic/visualization tools
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
import plotly.express as px
import plotly.graph_objects as go
import plotly.io as pio
import networkx as nx
import scipy as sp

# Import utility miscellanea
import json
import time
from typing import Dict, Iterable, List, Optional, Tuple
import requests
from tqdm import tqdm
import os

# Import Flask miscellanea
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# @app.get("/api/records")
# def records(category: str | None = None, year_min: int | None = None):
#     out = df
#     if category:
#         out = out[out["category"] == category]
#     if year_min:
#         out = out[out["year"] >= year_min]
#     return out.to_dict(orient="records")

# Import data and slice for display
DATA_DIR = Path(__file__).resolve().parent
 
miami_full = pd.read_csv(DATA_DIR / "miami-housing.csv", dtype={"PARCELNO": str})

# 10% random sample, reproducible with seed 81
miami_sample = miami_full.sample(frac=0.25, random_state=81).reset_index(drop=True)

print(f"Full: {len(miami_full):,} rows | Sample: {len(miami_sample):,} rows")

# Blocker check: how many noise-flagged houses survive the sample?
print("avno60plus = 1 in full data:", (miami_full["avno60plus"] == 1).sum())
print("avno60plus = 1 in sample:   ", (miami_sample["avno60plus"] == 1).sum())

miami_sample.to_csv(DATA_DIR / "miami_sample_10pct.csv", index=False)

print(miami_sample.head())