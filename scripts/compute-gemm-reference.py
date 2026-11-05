#!/usr/bin/env python3
"""
Compute the float64 reference values for the gemm-fp32-1024-seed42-torch probe.

Run locally (CPU only, no GPU required) with any torch installation:
  python3 scripts/compute-gemm-reference.py

torch.manual_seed(42) produces the same A and B matrices on every machine
regardless of hardware. Computing C = A @ B in float64 gives a stable
reference that any host's float32 GPU result can be checked against.

These values are committed into gemm-known-answer.ts. Anyone can reproduce
them by running this script.
"""

import torch
import numpy as np
import json

torch.manual_seed(42)

# Generate A and B in float64 on CPU — same seed the probe uses on the host.
# float64 gives enough precision that the rounded values are unambiguous.
A = torch.rand(1024, 1024, dtype=torch.float64)
B = torch.rand(1024, 1024, dtype=torch.float64)
C = A @ B

Cnp = C.numpy()

ref = {
    "benchmark_id": "gemm-fp32-1024-seed42-torch",
    "dtype":        "float64",
    "matrix_size":  1024,
    "seed":         42,
    "fp_sum":       round(float(Cnp.sum()),             4),
    "fp_norm":      round(float(np.linalg.norm(Cnp)),   4),
    "fp_corners":   [
        round(float(Cnp[0,  0]),  6),
        round(float(Cnp[0,  -1]), 6),
        round(float(Cnp[-1, 0]),  6),
        round(float(Cnp[-1, -1]), 6),
    ],
    "torch_version": torch.__version__,
}

print(json.dumps(ref, indent=2))
