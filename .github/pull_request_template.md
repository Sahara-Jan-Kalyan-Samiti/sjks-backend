## What changed

<!-- One or two sentences. Link the task or issue if there is one. -->

## Type of change

- [ ] New endpoint or feature
- [ ] Bug fix
- [ ] Payment, receipt or e-mail logic
- [ ] Refactor (no behaviour change)
- [ ] Build, CI or documentation

## Checklist

- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass
- [ ] New or changed behaviour has a test (payment rules especially)
- [ ] No secrets, `.env` files or personal data (PAN, phone, e-mail) are in the code or the logs
- [ ] The README API table is updated if an endpoint changed
- [ ] A database change has a matching migration in `sjks-database`, merged first
