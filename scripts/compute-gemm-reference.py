#!/usr/bin/env python3
"""
Compute the float64 reference values for the gemm-fp32-1024-seed42-torch probe.

Run locally (CPU only, no GPU required) with any torch installation:
  python3 scripts/compute-gemm-reference.py

GENERATION IDENTITY
===================
torch.rand with dtype=float32 and dtype=float64 draw from DIFFERENT RNG streams —
same seed does NOT produce the same matrix values. The probe generates A and B in
float32, so the reference must do the same, then upcast to float64 for the matmul:

    torch.manual_seed(42)
    A = torch.rand(1024, 1024, dtype=torch.float32).double()
    B = torch.rand(1024, 1024, dtype=torch.float32).double()
    C = A @ B   # float64 accumulation

This ensures the probe's GPU float32 result and the reference float64 result
are computing C for the SAME input matrices.

These values are committed into gemm-known-answer.ts. Anyone can reproduce
them by running this script.
"""

import torch
import numpy as np
import json

torch.manual_seed(42)

# Generate A and B as float32 (identical to the probe), upcast to float64
# so the matmul accumulates in full double precision.
A = torch.rand(1024, 1024, dtype=torch.float32).double()
B = torch.rand(1024, 1024, dtype=torch.float32).double()
C = A @ B

Cnp = C.numpy()

ref = {
    "benchmark_id":      "gemm-fp32-1024-seed42-torch",
    "generation_dtype":  "float32 -> double (probe-identical inputs, float64 matmul)",
    "matrix_size":       1024,
    "seed":              42,
    "fp_sum":            round(float(Cnp.sum()),           4),
    "fp_norm":           round(float(np.linalg.norm(Cnp)), 4),
    "fp_corners":        [
        round(float(Cnp[0,   0]),  6),
        round(float(Cnp[0,  -1]),  6),
        round(float(Cnp[-1,  0]),  6),
        round(float(Cnp[-1, -1]),  6),
    ],
    "A_0_0_float32":     float(A[0, 0]),   # pin for identity test
    "A_0_1_float32":     float(A[0, 1]),
    "torch_version":     torch.__version__,
}

print(json.dumps(ref, indent=2))
