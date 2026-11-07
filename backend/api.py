from pathlib import Path
 
# Import backend info
from flask import Flask, jsonify, redirect
from flask_cors import CORS

# Import pandas
import pandas as pd

# Import Flask miscellanea

app = Flask(__name__)
CORS(app)   # the frontend (port 5173) is a different origin

# Import data and slice for display
DATA_DIR = Path(__file__).resolve().parent
 
miami_full = pd.read_csv(DATA_DIR / "miami-housing.csv", dtype={"PARCELNO": str})

# 25% random sample, reproducible with seed 81
houses = miami_full.sample(frac=0.25, random_state=81).reset_index(drop=True)

# JSON has no NaN, so turn any missing values into null before sending
houses_records = houses.astype(object).where(pd.notna(houses), None).to_dict(orient="records")

# Redirection to "/api/houses"
@app.get("/")
def home():
    return redirect("/api/houses")

@app.get("/api/houses")
def get_houses():
    return jsonify(houses_records)


if __name__ == "__main__":
    print(f"Loaded {len(houses):,} houses")
    app.run(port=5001, debug=True)

# Miscellaneous data exploration; left over from defunct visualization

# print(f"Full: {len(miami_full):,} rows | Sample: {len(miami_sample):,} rows")

# # Blocker check: how many noise-flagged houses survive the sample?
# print("avno60plus = 1 in full data:", (miami_full["avno60plus"] == 1).sum())
# print("avno60plus = 1 in sample:   ", (miami_sample["avno60plus"] == 1).sum())

# miami_sample.to_csv(DATA_DIR / "miami_sample_10pct.csv", index=False)

# print(miami_sample.head())