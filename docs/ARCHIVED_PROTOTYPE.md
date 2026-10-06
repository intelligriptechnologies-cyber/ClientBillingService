# Archived prototype material

The earlier single-organization client-billing prototype and its in-memory
store were retired during the multi-tenant upgrade. Its `Client` terminology,
mock repository contracts, and browser-only lifecycle routes are not part of
the application.

The current product vocabulary is **tenant**, **customer**, **service**,
**contract**, **invoice**, **payment**, and **security deposit**. The current
implementation specification is the repository issue tracker specification;
the persistent tenant store and route handlers are the operational source of
truth for this demo.
