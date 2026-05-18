# Ofcom API setup (broadband + mobile coverage)

Ofcom's broadband and mobile coverage data is the official source the UK
regulator uses for its own public broadband-checker.ofcom.org.uk site. UMU
calls the same API on the server side and joins the result onto every
property page.

There is **no free real-time API** — you must register on Ofcom's developer
portal to get a subscription key. Registration is free; usage above the free
tier (1,000 requests/month at time of writing) is paid.

## 1. Register at developer.ofcom.org.uk

1. Go to <https://developer.ofcom.org.uk/>
2. Click **Sign up** (top right) — UK email address + verification
3. After log-in, browse the **API products** catalogue. The product UMU uses
   is **Connected Nations Coverage**. It includes:
   - `GET /broadband/coverage/{postcode}` — fixed broadband (FTTP, FTTC,
     cable, predicted speeds)
   - `GET /mobile/coverage/{postcode}` — outdoor + indoor 4G/5G availability
     per operator
4. Click **Subscribe** on the Connected Nations Coverage product.
5. Once approved (usually instant for the free tier), copy the **Primary key**
   from your subscription page.

## 2. Add the key to .env

Open `umu-backend/.env` and set:

```env
OFCOM_API_KEY=<your_primary_key>
```

No restart-with-Prisma routine needed for env-var changes — a plain backend
restart picks it up:

```powershell
cd d:\ReactProjects\op_nuxt\umu-backend
npm run start:dev
```

## 3. Sanity-check

```powershell
$h = @{ 'Ocp-Apim-Subscription-Key' = $env:OFCOM_API_KEY; Accept = 'application/json' }
Invoke-RestMethod -Uri 'https://api-proxy.ofcom.org.uk/broadband/coverage/SW1A1AA' -Headers $h
```

You should get an array with one object per premise in the postcode,
containing `FttpAvailability`, `FttcAvailability`, `MaxBbPredictedDown`,
and similar.

## 4. How UMU uses it

- `property.service.ts → fetchBroadband(postcode)` calls
  `/broadband/coverage/{postcode}` once per property page load (results
  flow through the `/property/:id/enrichment` endpoint).
- `property.service.ts → fetchMobileSignal(postcode)` calls
  `/mobile/coverage/{postcode}` on the same trip.
- Both return a `{ available: true, ... }` payload on success or
  `{ available: false, reason: '...' }` on failure (no_key, unauthorized,
  not_found, rate_limited, timeout, network). The Broadband sheet on the
  property page surfaces the reason directly so users see what's wrong.

## Failure-reason → UI message

| `reason`        | Cause                                                              |
|-----------------|--------------------------------------------------------------------|
| `no_key`        | OFCOM_API_KEY not set in .env                                       |
| `unauthorized`  | Key is wrong / expired / subscription cancelled                     |
| `rate_limited`  | Free-tier monthly quota exhausted — wait or upgrade                 |
| `not_found`     | Ofcom has no entries for this postcode (very new build, etc.)       |
| `no_premises`   | API returned 200 but the premises array was empty                   |
| `timeout`       | Ofcom didn't respond in 8s                                          |
| `network`       | DNS / connectivity error                                            |

## Geo note

Ofcom appears to geo-block non-UK IPs (DNS-level) on `*.ofcom.org.uk`. From
non-UK dev machines you'll see `network` even with a valid key. Production
infrastructure deployed in UK/EU regions will work normally.
