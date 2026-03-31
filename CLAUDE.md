# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Goal
I have the good old dvdrental schema in postgresql 
I want to create a javascript app that acts like a complete dvd rental system, using the data in the database. it should be possible to administer the cities, store, films, employees, customers, and actually have a possibility to rent out movies. The design shall be 90s blockbusters.   

## Running the app

```bash
node server.js        # Start the server (default port 3000)
```

Requires a `.env` file with:
```
DB_HOST=...
DB_PORT=5432
DB_USER=...
DB_PASSWORD=...
DB_NAME=dvdrental
```

## Architecture

This is a Node.js/Express server-side rendered app using EJS templates with `express-ejs-layouts`. It connects directly to a PostgreSQL `dvdrental` database via `pg` (pool in `db.js`).

**Request flow:** `server.js` → route file → raw SQL via `db.query()` → EJS view

**Key patterns:**
- All routes use `async/await` and pass errors to `next(err)` for the central error handler
- Flash messages are passed via query string (`?flash=...&flashType=info`) after redirects, then forwarded to views
- `method-override` middleware enables `PUT`/`DELETE` from HTML forms via `?_method=PUT`
- Every view receives `title`, `currentPage`, and `flash` as template variables; `currentPage` drives the active nav link in `layout.ejs`
- Pagination is manual: `LIMIT`/`OFFSET` in SQL, `totalPages` + `page` passed to view

**Routes and their responsibilities:**

| Route file | Path | Coverage |
|---|---|---|
| `routes/dashboard.js` | `/` | Stats aggregation + recent rentals |
| `routes/films.js` | `/films` | Full CRUD; manages `film_actor` and `film_category` join tables |
| `routes/customers.js` | `/customers` | Full CRUD; creates/updates `address` row alongside customer |
| `routes/rentals.js` | `/rentals` | List open rentals, create rental + payment, process return + late fee |
| `routes/staff.js` | `/staff` | Full CRUD |
| `routes/stores.js` | `/stores` | Full CRUD |
| `routes/cities.js` | `/cities` | Full CRUD |

**Rental workflow:**
1. `GET /rentals/new` — pick customer & film (AJAX film search via `GET /rentals/search-films`)
2. `POST /rentals` — inserts into `rental` and `payment` tables simultaneously
3. `GET /rentals/:id/return` — calculates late fees (days over `rental_duration` × `rental_rate`)
4. `POST /rentals/:id/return` — sets `return_date`, optionally inserts a late-fee `payment`

**Views structure:** `views/layout.ejs` is the shared shell (Blockbuster 90s theme with `<marquee>`). All pages use `<%- body %>` injection. Each resource has its own subfolder with `index.ejs`, `form.ejs`, and where relevant `detail.ejs`.

**Styling:** Single `public/style.css` — Blockbuster yellow/blue color scheme, no external CSS framework.
