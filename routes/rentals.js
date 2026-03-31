const express = require('express');
const router = express.Router();
const db = require('../db');

// List open rentals
router.get('/', async (req, res, next) => {
  try {
    const { search, store, page = 1 } = req.query;
    const limit = 30;
    const offset = (page - 1) * limit;
    const params = [];
    const conditions = ['r.return_date IS NULL'];

    if (search) { params.push(`%${search}%`); conditions.push(`(c.first_name || ' ' || c.last_name ILIKE $${params.length} OR f.title ILIKE $${params.length})`); }
    if (store) { params.push(store); conditions.push(`i.store_id = $${params.length}`); }

    const where = 'WHERE ' + conditions.join(' AND ');

    const [rentals, count, stores] = await Promise.all([
      db.query(`
        SELECT r.rental_id, r.rental_date,
               c.customer_id, c.first_name || ' ' || c.last_name AS customer,
               f.film_id, f.title, f.rental_duration,
               i.store_id, sci.city AS store_city,
               st.first_name || ' ' || st.last_name AS staff_name,
               (CURRENT_DATE - r.rental_date::date) AS days_out
        FROM rental r
        JOIN customer c ON r.customer_id = c.customer_id
        JOIN inventory i ON r.inventory_id = i.inventory_id
        JOIN film f ON i.film_id = f.film_id
        JOIN staff st ON r.staff_id = st.staff_id
        JOIN store sto ON i.store_id = sto.store_id
        JOIN address sa ON sto.address_id = sa.address_id
        JOIN city sci ON sa.city_id = sci.city_id
        ${where}
        ORDER BY r.rental_date ASC
        LIMIT ${limit} OFFSET ${offset}
      `, params),
      db.query(`
        SELECT COUNT(*) FROM rental r
        JOIN customer c ON r.customer_id = c.customer_id
        JOIN inventory i ON r.inventory_id = i.inventory_id
        JOIN film f ON i.film_id = f.film_id
        ${where}
      `, params),
      db.query('SELECT st.store_id, ci.city FROM store st JOIN address a ON st.address_id = a.address_id JOIN city ci ON a.city_id = ci.city_id ORDER BY st.store_id'),
    ]);

    res.render('rentals/index', {
      title: 'Rentals',
      currentPage: 'rentals',
      flash: req.query.flash ? { type: req.query.flashType || 'info', message: req.query.flash } : null,
      rentals: rentals.rows,
      stores: stores.rows,
      totalPages: Math.ceil(count.rows[0].count / limit),
      page: parseInt(page),
      query: req.query,
    });
  } catch (err) { next(err); }
});

// New rental — step 1: pick customer & film
router.get('/new', async (req, res, next) => {
  try {
    const { customer_id, film_id } = req.query;

    const [customers, stores, staffList] = await Promise.all([
      db.query(`SELECT customer_id, first_name || ' ' || last_name AS name, store_id FROM customer WHERE activebool=true ORDER BY last_name, first_name`),
      db.query('SELECT st.store_id, ci.city FROM store st JOIN address a ON st.address_id = a.address_id JOIN city ci ON a.city_id = ci.city_id ORDER BY st.store_id'),
      db.query(`SELECT staff_id, first_name || ' ' || last_name AS name, store_id FROM staff WHERE active=true ORDER BY last_name, first_name`),
    ]);

    let film = null;
    let customer = null;
    let availableInventory = [];

    if (film_id) {
      const fRes = await db.query('SELECT film_id, title, rental_rate, rental_duration FROM film WHERE film_id=$1', [film_id]);
      film = fRes.rows[0] || null;
    }

    if (customer_id) {
      const cRes = await db.query('SELECT customer_id, first_name || \' \' || last_name AS name, store_id FROM customer WHERE customer_id=$1', [customer_id]);
      customer = cRes.rows[0] || null;
    }

    if (film_id && req.query.store_id) {
      const invRes = await db.query(`
        SELECT i.inventory_id, i.store_id FROM inventory i
        WHERE i.film_id = $1 AND i.store_id = $2
        AND i.inventory_id NOT IN (SELECT inventory_id FROM rental WHERE return_date IS NULL)
      `, [film_id, req.query.store_id]);
      availableInventory = invRes.rows;
    }

    res.render('rentals/new', {
      title: 'New Rental',
      currentPage: 'rentals',
      flash: null,
      customers: customers.rows,
      stores: stores.rows,
      staffList: staffList.rows,
      film,
      customer,
      availableInventory,
      query: req.query,
    });
  } catch (err) { next(err); }
});

// Film search for rental
router.get('/search-films', async (req, res, next) => {
  try {
    const { q, store_id } = req.query;
    if (!q || q.length < 2) return res.json([]);

    const films = await db.query(`
      SELECT f.film_id, f.title, f.rental_rate, f.rental_duration,
             COUNT(i.inventory_id) FILTER (
               WHERE i.inventory_id NOT IN (SELECT inventory_id FROM rental WHERE return_date IS NULL)
               AND ($2::int IS NULL OR i.store_id = $2)
             ) AS available
      FROM film f
      LEFT JOIN inventory i ON f.film_id = i.film_id
      WHERE f.title ILIKE $1
      GROUP BY f.film_id
      ORDER BY f.title
      LIMIT 15
    `, [`%${q}%`, store_id || null]);

    res.json(films.rows);
  } catch (err) { next(err); }
});

// Create rental
router.post('/', async (req, res, next) => {
  try {
    const { customer_id, inventory_id, staff_id, amount } = req.body;

    const rental = await db.query(
      'INSERT INTO rental (rental_date, inventory_id, customer_id, staff_id) VALUES (NOW(),$1,$2,$3) RETURNING rental_id',
      [inventory_id, customer_id, staff_id]
    );

    await db.query(
      'INSERT INTO payment (customer_id, staff_id, rental_id, amount, payment_date) VALUES ($1,$2,$3,$4,NOW())',
      [customer_id, staff_id, rental.rows[0].rental_id, amount]
    );

    res.redirect(`/rentals?flash=Rental+created+successfully`);
  } catch (err) { next(err); }
});

// Return form
router.get('/:id/return', async (req, res, next) => {
  try {
    const [rental, staffList] = await Promise.all([
      db.query(`
        SELECT r.rental_id, r.rental_date, r.return_date,
               c.first_name || ' ' || c.last_name AS customer, c.customer_id,
               f.title, f.rental_rate, f.rental_duration,
               (CURRENT_DATE - r.rental_date::date) AS days_out,
               p.amount AS paid
        FROM rental r
        JOIN customer c ON r.customer_id = c.customer_id
        JOIN inventory i ON r.inventory_id = i.inventory_id
        JOIN film f ON i.film_id = f.film_id
        LEFT JOIN payment p ON r.rental_id = p.rental_id
        WHERE r.rental_id = $1
      `, [req.params.id]),
      db.query(`SELECT staff_id, first_name || ' ' || last_name AS name, store_id FROM staff WHERE active=true ORDER BY last_name, first_name`),
    ]);

    if (!rental.rows.length) return res.status(404).render('error', { message: 'Rental not found', title: 'Not Found', currentPage: 'rentals', flash: null });

    const r = rental.rows[0];
    if (r.return_date) return res.redirect(`/rentals?flash=Already+returned`);

    const daysLate = Math.max(0, r.days_out - r.rental_duration);
    const lateFee = daysLate * parseFloat(r.rental_rate);

    res.render('rentals/return', {
      title: 'Return Film',
      currentPage: 'rentals',
      flash: null,
      rental: r,
      daysLate,
      lateFee: lateFee.toFixed(2),
      staffList: staffList.rows,
    });
  } catch (err) { next(err); }
});

// Process return
router.post('/:id/return', async (req, res, next) => {
  try {
    const { late_fee, staff_id } = req.body;

    await db.query('UPDATE rental SET return_date=NOW() WHERE rental_id=$1', [req.params.id]);

    if (late_fee && parseFloat(late_fee) > 0) {
      const rental = await db.query('SELECT customer_id FROM rental WHERE rental_id=$1', [req.params.id]);
      await db.query(
        'INSERT INTO payment (customer_id, staff_id, rental_id, amount, payment_date) VALUES ($1,$2,$3,$4,NOW())',
        [rental.rows[0].customer_id, staff_id, req.params.id, late_fee]
      );
    }

    res.redirect('/rentals?flash=Film+returned+successfully');
  } catch (err) { next(err); }
});

module.exports = router;
