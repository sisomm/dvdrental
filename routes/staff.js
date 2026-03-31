const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res, next) => {
  try {
    const staff = await db.query(`
      SELECT s.*, st.store_id,
             a.address, ci.city, co.country,
             sci.city AS store_city
      FROM staff s
      JOIN store st ON s.store_id = st.store_id
      LEFT JOIN address a ON s.address_id = a.address_id
      LEFT JOIN city ci ON a.city_id = ci.city_id
      LEFT JOIN country co ON ci.country_id = co.country_id
      JOIN address sa ON st.address_id = sa.address_id
      JOIN city sci ON sa.city_id = sci.city_id
      ORDER BY s.last_name, s.first_name
    `);
    res.render('staff/index', {
      title: 'Staff',
      currentPage: 'staff',
      flash: req.query.flash ? { type: 'info', message: req.query.flash } : null,
      staff: staff.rows,
    });
  } catch (err) { next(err); }
});

router.get('/new', async (req, res, next) => {
  try {
    const [stores, cities] = await Promise.all([
      db.query('SELECT st.store_id, ci.city FROM store st JOIN address a ON st.address_id = a.address_id JOIN city ci ON a.city_id = ci.city_id ORDER BY st.store_id'),
      db.query('SELECT ci.city_id, ci.city, co.country FROM city ci JOIN country co ON ci.country_id = co.country_id ORDER BY co.country, ci.city'),
    ]);
    res.render('staff/form', {
      title: 'New Staff',
      currentPage: 'staff',
      flash: null,
      member: {},
      address: {},
      stores: stores.rows,
      cities: cities.rows,
      action: '/staff',
    });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { first_name, last_name, email, store_id, username, password, active,
            address, address2, district, city_id, postal_code, phone } = req.body;

    const addrRes = await db.query(
      'INSERT INTO address (address, address2, district, city_id, postal_code, phone) VALUES ($1,$2,$3,$4,$5,$6) RETURNING address_id',
      [address, address2 || null, district, city_id, postal_code || null, phone || '']
    );

    const res2 = await db.query(
      'INSERT INTO staff (first_name, last_name, email, store_id, username, password, active, address_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING staff_id',
      [first_name, last_name, email || null, store_id, username, password || null, active === 'on', addrRes.rows[0].address_id]
    );

    res.redirect(`/staff?flash=Staff+member+added`);
  } catch (err) { next(err); }
});

router.get('/:id/edit', async (req, res, next) => {
  try {
    const [member, stores, cities] = await Promise.all([
      db.query(`SELECT s.*, a.address, a.address2, a.district, a.postal_code, a.phone, a.city_id FROM staff s LEFT JOIN address a ON s.address_id = a.address_id WHERE s.staff_id=$1`, [req.params.id]),
      db.query('SELECT st.store_id, ci.city FROM store st JOIN address a ON st.address_id = a.address_id JOIN city ci ON a.city_id = ci.city_id ORDER BY st.store_id'),
      db.query('SELECT ci.city_id, ci.city, co.country FROM city ci JOIN country co ON ci.country_id = co.country_id ORDER BY co.country, ci.city'),
    ]);
    if (!member.rows.length) return res.status(404).render('error', { message: 'Staff not found', title: 'Not Found', currentPage: 'staff', flash: null });
    res.render('staff/form', {
      title: 'Edit Staff',
      currentPage: 'staff',
      flash: null,
      member: member.rows[0],
      address: member.rows[0],
      stores: stores.rows,
      cities: cities.rows,
      action: `/staff/${req.params.id}?_method=PUT`,
    });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { first_name, last_name, email, store_id, username, password, active,
            address, address2, district, city_id, postal_code, phone } = req.body;
    const id = req.params.id;

    const s = await db.query('SELECT address_id FROM staff WHERE staff_id=$1', [id]);
    if (!s.rows.length) return res.status(404).render('error', { message: 'Staff not found', title: 'Not Found', currentPage: 'staff', flash: null });

    await db.query('UPDATE address SET address=$1,address2=$2,district=$3,city_id=$4,postal_code=$5,phone=$6 WHERE address_id=$7',
      [address, address2||null, district, city_id, postal_code||null, phone||'', s.rows[0].address_id]);

    const updateFields = ['first_name=$1','last_name=$2','email=$3','store_id=$4','username=$5','active=$6','last_update=NOW()'];
    const vals = [first_name, last_name, email||null, store_id, username, active==='on', id];

    if (password) { updateFields.push(`password=$${vals.length}`); vals.splice(vals.length-1, 0, password); }

    await db.query(`UPDATE staff SET ${updateFields.join(',')} WHERE staff_id=$${vals.length}`, vals);
    res.redirect('/staff?flash=Staff+member+updated');
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await db.query('DELETE FROM staff WHERE staff_id=$1', [req.params.id]);
    res.redirect('/staff?flash=Staff+member+deleted');
  } catch (err) { next(err); }
});

module.exports = router;
