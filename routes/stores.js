const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res, next) => {
  try {
    const stores = await db.query(`
      SELECT st.store_id, st.last_update,
             s.first_name || ' ' || s.last_name AS manager,
             a.address, ci.city, co.country,
             COUNT(DISTINCT c.customer_id) AS customers,
             COUNT(DISTINCT i.inventory_id) AS inventory
      FROM store st
      JOIN staff s ON st.manager_staff_id = s.staff_id
      JOIN address a ON st.address_id = a.address_id
      JOIN city ci ON a.city_id = ci.city_id
      JOIN country co ON ci.country_id = co.country_id
      LEFT JOIN customer c ON st.store_id = c.store_id
      LEFT JOIN inventory i ON st.store_id = i.store_id
      GROUP BY st.store_id, s.first_name, s.last_name, a.address, ci.city, co.country
      ORDER BY st.store_id
    `);
    res.render('stores/index', {
      title: 'Stores',
      currentPage: 'stores',
      flash: req.query.flash ? { type: 'info', message: req.query.flash } : null,
      stores: stores.rows,
    });
  } catch (err) { next(err); }
});

router.get('/:id/edit', async (req, res, next) => {
  try {
    const [store, staff, cities] = await Promise.all([
      db.query(`SELECT st.*, a.address, a.address2, a.district, a.postal_code, a.phone, a.city_id FROM store st JOIN address a ON st.address_id = a.address_id WHERE st.store_id=$1`, [req.params.id]),
      db.query('SELECT staff_id, first_name || \' \' || last_name AS name FROM staff ORDER BY last_name'),
      db.query('SELECT ci.city_id, ci.city, co.country FROM city ci JOIN country co ON ci.country_id = co.country_id ORDER BY co.country, ci.city'),
    ]);
    if (!store.rows.length) return res.status(404).render('error', { message: 'Store not found', title: 'Not Found', currentPage: 'stores', flash: null });
    res.render('stores/form', {
      title: 'Edit Store',
      currentPage: 'stores',
      flash: null,
      store: store.rows[0],
      staff: staff.rows,
      cities: cities.rows,
      action: `/stores/${req.params.id}?_method=PUT`,
    });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { manager_staff_id, address, address2, district, city_id, postal_code, phone } = req.body;
    const s = await db.query('SELECT address_id FROM store WHERE store_id=$1', [req.params.id]);
    if (!s.rows.length) return res.status(404).render('error', { message: 'Store not found', title: 'Not Found', currentPage: 'stores', flash: null });

    await db.query('UPDATE address SET address=$1,address2=$2,district=$3,city_id=$4,postal_code=$5,phone=$6 WHERE address_id=$7',
      [address, address2||null, district, city_id, postal_code||null, phone||'', s.rows[0].address_id]);
    await db.query('UPDATE store SET manager_staff_id=$1, last_update=NOW() WHERE store_id=$2', [manager_staff_id, req.params.id]);

    res.redirect('/stores?flash=Store+updated+successfully');
  } catch (err) { next(err); }
});

module.exports = router;
