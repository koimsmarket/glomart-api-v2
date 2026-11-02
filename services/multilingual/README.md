# Multilingual domain layout / V002

- `ui/`: UI dictionary completion and existing UI JSON publisher.
- `category/`: category dictionary 25-language completeness validation, without changing existing category publisher.
- Future phase 2: separate language registry and extra-language storage; **NOT ACTIVE** in V002.
- Frontend paths remain untouched. Future dynamically loaded JS MUST use actual resolved `?v=gm_v1` variable (not literal fixed cache token).
- This is a **partial-phase development package**, not production-ready end-to-end auto deploy.
