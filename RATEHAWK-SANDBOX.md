# RateHawk sandbox preparation

This branch prepares a separate server-side RateHawk client. It does not add RateHawk to public hotel results or change the existing Nuitee booking flow.

## Safe environment setup

Add these as Vercel server environment variables only after RateHawk provides sandbox credentials:

- `RATEHAWK_ENV=sandbox`
- `RATEHAWK_KEY_ID=<sandbox key id>`
- `RATEHAWK_API_KEY=<sandbox API key>`

The client defaults to the sandbox host and uses HTTP Basic Authentication. Never put either credential in browser JavaScript, HTML, a URL, or a repository file.

ETG calls the sandbox and test environments different things. Use only the sandbox key, host, and sample data for this work. Do not use the `test` key or test hotel `hid=8473727`: ETG documents that bookings there carry real financial responsibility.

## Planned validation sequence

1. Load and map ETG region IDs separately from the existing LiteAPI destination IDs.
2. Search a supported sandbox region with `/api/b2b/v3/search/serp/region/`.
3. Open a selected property's hotelpage with `/api/b2b/v3/search/hp/`, then prebook the selected rate with `/api/b2b/v3/hotel/prebook/`.
4. Create and start a sandbox booking using `/api/b2b/v3/hotel/order/booking/form/` and `/api/b2b/v3/hotel/order/booking/finish/`; poll `/api/b2b/v3/hotel/order/booking/finish/status/` until final status.
5. Retrieve the confirmed booking and cancel it through `/api/b2b/v3/hotel/order/cancel/` when required by the scenario.

Sandbox bookings and cancellations do not create real financial transactions. The sandbox does not support every production feature (including 3-D Secure); its sample data, region IDs, and returned currencies must stay inside sandbox tests.

## Not wired yet

The current change is deliberately a transport/configuration foundation with offline tests. Public search, hotel deduplication, price selection, and booking remain unwired until the sandbox credentials work and the actual RateHawk response payloads are captured. This avoids guessing the mapping between RateHawk rates and the site's Nuitee-shaped offers.

## Official references

- [ETG authorization and environment separation](https://docs.emergingtravel.com/docs/fundamentals/authorization/)
- [Search by region](https://docs.emergingtravel.com/docs/b2b-api/hotel-search/search-by-region/)
- [Retrieve hotelpage](https://docs.emergingtravel.com/docs/b2b-api/hotel-search/retrieve-hotelpage/)
- [Prebook from hotelpage](https://docs.emergingtravel.com/docs/b2b-api/hotel-search/prebook-rate-from-hotelpage-step/)
- [Create booking process](https://docs.emergingtravel.com/docs/b2b-api/booking/create-booking-process/)
- [Start booking process](https://docs.emergingtravel.com/docs/b2b-api/booking/start-booking-process/)
- [Check booking process](https://docs.emergingtravel.com/docs/b2b-api/booking/check-booking-process/)
- [Cancel booking](https://docs.emergingtravel.com/docs/b2b-api/post-booking/cancel-booking/)
