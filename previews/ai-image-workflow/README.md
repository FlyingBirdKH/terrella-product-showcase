# Two-step AI image workflow: synthetic preview

Isolated implementation for review. No real catalog data, storage URLs, Drive links, private conversation references or credentials are included.

Open `preview/index.html` to test product selection and per-image selection. Everything is visibly marked synthetic and unsubmitted. Identity, asset versions, content hashes and destination are separate from list order. The disabled actions do not generate, approve, upload or publish anything.

`server/workflow-service.cjs` implements validation, a trusted identity-adapter boundary, an immutable request, per-image approval intent, idempotency and transactional outbox acceptance. It is disabled by default. `server/image-workflow.cjs` is a disabled Vercel endpoint adapter. The SQL file is a review-only migration and has NOT been applied. No production identity or database is selected.

Run with Node 24 or later, without dependencies:

`node --test verification/contract.test.cjs verification/service.test.cjs verification/persistence.test.cjs`

The SQLite adapter is strictly a local test fixture. Serverless disks must not be used as a production persistence substitute. Tests do not imply end-to-end generation or upload connectivity.

All example domains, product IDs and hashes are synthetic. Replace fixture policy only inside an approved integration with the existing catalog and its single uploader. Keep real generation-conversation routing on the server.
