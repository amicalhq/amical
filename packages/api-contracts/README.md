# API contracts

Request and response schemas for the Amical cloud APIs that the desktop app calls.

The cloud service owns these schemas. The files in `src/` are byte copies. Do not
edit or format them here, except `src/apps/v1/index.ts`, which is local. To change
a contract, change it in the service, then copy it again.

Desktop adds local rules on top of a schema where a released app must not depend
on the numbers in this copy. See `apps/desktop/src/types/settings-sync.ts`.
