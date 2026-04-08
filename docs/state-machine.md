# Worker State Machine

```mermaid
stateDiagram-v2
  [*] --> INIT
  INIT --> LOADING
  LOADING --> READY
  READY --> LOADING
  READY --> RUNNING
  RUNNING --> READY
  INIT --> ERROR
  LOADING --> ERROR
  READY --> ERROR
  RUNNING --> ERROR
  READY --> TERMINATED
  ERROR --> TERMINATED
  LOADING --> TERMINATED
```

## Notes
- `INIT` means the worker is alive but no model is loaded.
- `LOADING` covers initial model ingestion and explicit model replacement.
- `ERROR` is terminal for serving requests; callers should destroy and recreate workers.
