const express = require('express');
const router = express.Router();
const db = require('../db');

// List
router.get('/', async (req, res, next) => {
  try {
    const { search, active, page = 1 } = req.query;
    const limit = 25;
    const offset = (page - 1) * limit;
    const params = [];
    const conditions = [];

    if (search) { params.push(`%${search}%`); conditions.push(`(c.first_name || ' ' || c.last_name ILIKE $${params.length} OR c.email ILIKE $${params.length})`); }
    if (active === '1') conditions.push('c.activebool = true');
    if (active === '0') conditions.push('c.activebool = false');

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const [customers, count] = await Promise.all([
      db.query(`
        SELECT c.customer_id, c.first_name, c.last_name, c.email, c.activebool,
               c.create_date, ci.city, co.country,
               COUNT(r.rental_id) AS total_rentals
        FROM customer c
        LEFT JOIN address a ON c.address_id = a.address_id
        LEFT JOIN city ci ON a.city_id = ci.city_id
        LEFT JOIN country co ON ci.country_id = co.country_id
        LEFT JOIN rental r ON c.customer_id = r.customer_id
        ${where}
        GROUP BY c.customer_id, ci.city, co.country
        ORDER BY c.last_name, c.first_name
        LIMIT ${limit} OFFSET ${offset}
      `, params),
      db.query(`SELECT COUNT(*) FROM customer c ${where}`, params),
    ]);

    res.render('customers/index', {
      title: 'Customers',
      currentPage: 'customers',
      flash: req.query.flash ? { type: req.query.flashType || 'info', message: req.query.flash } : null,
      customers: customers.rows,
      totalPages: Math.ceil(count.rows[0].count / limit),
      page: parseInt(page),
      query: req.query,
    });
  } catch (err) { next(err); }
});

// New form
router.get('/new', async (req, res, next) => {
  try {
    const [stores, cities] = await Promise.all([
      db.query('SELECT st.store_id, ci.city FROM store st JOIN address a ON st.address_id = a.address_id JOIN city ci ON a.city_id = ci.city_id ORDER BY st.store_id'),
      db.query('SELECT ci.city_id, ci.city, co.country FROM city ci JOIN country co ON ci.country_id = co.country_id ORDER BY co.country, ci.city'),
    ]);
    res.render('customers/form', {
      title: 'New Customer',
      currentPage: 'customers',
      flash: null,
      customer: {},
      address: {},
      stores: stores.rows,
      cities: cities.rows,
      action: '/customers',
    });
  } catch (err) { next(err); }
});

// Create
router.post('/', async (req, res, next) => {
  try {
    const { first_name, last_name, email, store_id, activebool,
            address, address2, district, city_id, postal_code, phone } = req.body;

    const addrResult = await db.query(
      'INSERT INTO address (address, address2, district, city_id, postal_code, phone) VALUES ($1,$2,$3,$4,$5,$6) RETURNING address_id',
      [address, address2 || null, district, city_id, postal_code || null, phone || '']
    );

    const custResult = await db.query(
      'INSERT INTO customer (store_id, first_name, last_name, email, address_id, activebool) VALUES ($1,$2,$3,$4,$5,$6) RETURNING customer_id',
      [store_id, first_name, last_name, email || null, addrResult.rows[0].address_id, activebool === 'on' || activebool === 'true']
    );

    res.redirect(`/customers/${custResult.rows[0].customer_id}?flash=Customer+created+successfully`);
  } catch (err) { next(err); }
});

// Detail / rental history
router.get('/:id', async (req, res, next) => {
  try {
    const [customer, rentals] = await Promise.all([
      db.query(`
        SELECT c.*, a.address, a.address2, a.district, a.postal_code, a.phone,
               ci.city_id, ci.city, co.country,
               sci.city AS store_city
        FROM customer c
        JOIN address a ON c.address_id = a.address_id
        JOIN city ci ON a.city_id = ci.city_id
        JOIN country co ON ci.country_id = co.country_id
        JOIN store sto ON c.store_id = sto.store_id
        JOIN address sa ON sto.address_id = sa.address_id
        JOIN city sci ON sa.city_id = sci.city_id
        WHERE c.customer_id = $1
      `, [req.params.id]),
      db.query(`
        SELECT r.rental_id, r.rental_date, r.return_date, f.title,
               p.amount, s.store_id
        FROM rental r
        JOIN inventory i ON r.inventory_id = i.inventory_id
        JOIN film f ON i.film_id = f.film_id
        JOIN store s ON i.store_id = s.store_id
        LEFT JOIN payment p ON r.rental_id = p.rental_id
        WHERE r.customer_id = $1
        ORDER BY r.rental_date DESC
        LIMIT 50
      `, [req.params.id]),
    ]);

    if (!customer.rows.length) return res.status(404).render('error', { message: 'Customer not found', title: 'Not Found', currentPage: 'customers', flash: null });

    res.render('customers/detail', {
      title: customer.rows[0].first_name + ' ' + customer.rows[0].last_name,
      currentPage: 'customers',
      flash: req.query.flash ? { type: 'info', message: req.query.flash } : null,
      customer: customer.rows[0],
      rentals: rentals.rows,
    });
  } catch (err) { next(err); }
});

// Edit form
router.get('/:id/edit', async (req, res, next) => {
  try {
    const [customer, stores, cities] = await Promise.all([
      db.query(`
        SELECT c.*, a.address, a.address2, a.district, a.postal_code, a.phone, a.city_id
        FROM customer c JOIN address a ON c.address_id = a.address_id
        WHERE c.customer_id = $1
      `, [req.params.id]),
      db.query('SELECT st.store_id, ci.city FROM store st JOIN address a ON st.address_id = a.address_id JOIN city ci ON a.city_id = ci.city_id ORDER BY st.store_id'),
      db.query('SELECT ci.city_id, ci.city, co.country FROM city ci JOIN country co ON ci.country_id = co.country_id ORDER BY co.country, ci.city'),
    ]);

    if (!customer.rows.length) return res.status(404).render('error', { message: 'Customer not found', title: 'Not Found', currentPage: 'customers', flash: null });

    res.render('customers/form', {
      title: 'Edit Customer',
      currentPage: 'customers',
      flash: null,
      customer: customer.rows[0],
      address: customer.rows[0],
      stores: stores.rows,
      cities: cities.rows,
      action: `/customers/${req.params.id}?_method=PUT`,
    });
  } catch (err) { next(err); }
});

// Update
router.put('/:id', async (req, res, next) => {
  try {
    const { first_name, last_name, email, store_id, activebool,
            address, address2, district, city_id, postal_code, phone } = req.body;
    const id = req.params.id;

    const cust = await db.query('SELECT address_id FROM customer WHERE customer_id=$1', [id]);
    if (!cust.rows.length) return res.status(404).render('error', { message: 'Customer not found', title: 'Not Found', currentPage: 'customers', flash: null });

    const addrId = cust.rows[0].address_id;
    await db.query(
      'UPDATE address SET address=$1, address2=$2, district=$3, city_id=$4, postal_code=$5, phone=$6 WHERE address_id=$7',
      [address, address2 || null, district, city_id, postal_code || null, phone || '', addrId]
    );
    await db.query(
      'UPDATE customer SET first_name=$1, last_name=$2, email=$3, store_id=$4, activebool=$5, last_update=NOW() WHERE customer_id=$6',
      [first_name, last_name, email || null, store_id, activebool === 'on' || activebool === 'true', id]
    );

    res.redirect(`/customers/${id}?flash=Customer+updated+successfully`);
  } catch (err) { next(err); }
});

// Delete
router.delete('/:id', async (req, res, next) => {
  try {
    const cust = await db.query('SELECT address_id FROM customer WHERE customer_id=$1', [req.params.id]);
    if (cust.rows.length) {
      await db.query('DELETE FROM customer WHERE customer_id=$1', [req.params.id]);
      await db.query('DELETE FROM address WHERE address_id=$1', [cust.rows[0].address_id]);
    }
    res.redirect('/customers?flash=Customer+deleted');
  } catch (err) { next(err); }
});

module.exports = router;
