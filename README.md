# Clinic Booking

A small booking API for a clinic, plus a web page where patients can see open slots, book one and get a confirmation.

Live: https://clinicbooking-1ujf.onrender.com

Built with Node, Express, TypeScript, Postgres (Neon) and React. It's hosted on Render.

## API

All requests need an `X-API-Key` header.

- `POST /reset` replaces all slots and clears bookings
- `GET /slots` lists slots, optionally filtered with `?provider=`
- `POST /bookings` books a slot
- `GET /bookings/:id` gets a booking
- `DELETE /bookings/:id` cancels a booking
- `GET /bookings?email=` lists someone's bookings, with `limit` and `cursor` for paging

Example:

```bash
curl -X POST https://clinicbooking-1ujf.onrender.com/bookings \
  -H "X-API-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"slot_id":"s1","name":"Ada Obi","email":"ada@example.com"}'
```

## Notes

- Double bookings are blocked by a unique index in Postgres, so two people can't get the same slot even if they book at the same time.
- Send an `Idempotency-Key` header to make retries safe. The same key returns the original response instead of booking again.
- Each email can make 5 booking attempts per minute. After that the API returns 429 with a `Retry-After` header.
- The web page calls the API through `/api/...` on the same server, which adds the key, so the key isn't exposed in the browser.

## Running locally

You'll need Node 20+ and a Postgres database.

```bash
npm install
cp .env.example .env   # add your DATABASE_URL and API_KEY
npm run migrate
npm run dev
```

The API runs on http://localhost:3000. To work on the page:

```bash
cd client
npm install
npm run dev
```

Then open http://localhost:5173.
