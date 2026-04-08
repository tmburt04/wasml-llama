# Failure Cases

| Category | Stable Code Prefix | Default Strategy |
| --- | --- | --- |
| Build Errors | `BUILD_` | fail pipeline immediately |
| Initialization Errors | `INIT_` | reject and destroy runtime |
| Memory Errors | `MEMORY_` | terminate worker and recreate cleanly |
| Model Errors | `MODEL_` | retry with backoff and emit each attempt |
| Inference Errors | `INFER_` | surface error and dispose broken worker |
| Protocol Errors | `PROTO_` | reject request immediately |
