const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res, next) => {
  try {
    const { search, country, page = 1 } = req.query;
    const limit = 30;
    const offset = (page - 1) * limit;
    const params = [];
    const conditions = [];

    if (search) { params.push(`%${search}%`); conditions.push(`ci.city ILIKE $${params.length}`); }
    if (country) { params.push(country); conditions.push(`co.country_id = $${params.length}`); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const [cities, count, countries] = await Promise.all([
      db.query(`
        SELECT ci.city_id, ci.city, co.country_id, co.country
        FROM city ci JOIN country co ON ci.country_id = co.country_id
        ${where}
        ORDER BY co.country, ci.city
        LIMIT ${limit} OFFSET ${offset}
      `, params),
      db.query(`SELECT COUNT(*) FROM city ci JOIN country co ON ci.country_id = co.country_id ${where}`, params),
      db.query('SELECT * FROM country ORDER BY country'),
    ]);

    res.render('cities/index', {
      title: 'Cities',
      currentPage: 'cities',
      flash: req.query.flash ? { type: 'info', message: req.query.flash } : null,
      cities: cities.rows,
      countries: countries.rows,
      totalPages: Math.ceil(count.rows[0].count / limit),
      page: parseInt(page),
      query: req.query,
    });
  } catch (err) { next(err); }
});

router.get('/new', async (req, res, next) => {
  try {
    const countries = await db.query('SELECT * FROM country ORDER BY country');
    res.render('cities/form', {
      title: 'New City',
      currentPage: 'cities',
      flash: null,
      city: {},
      countries: countries.rows,
      action: '/cities',
      countryAction: '/cities/countries',
    });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { city, country_id } = req.body;
    await db.query('INSERT INTO city (city, country_id) VALUES ($1,$2)', [city, country_id]);
    res.redirect('/cities?flash=City+added');
  } catch (err) { next(err); }
});

router.get('/:id/edit', async (req, res, next) => {
  try {
    const [city, countries] = await Promise.all([
      db.query('SELECT * FROM city WHERE city_id=$1', [req.params.id]),
      db.query('SELECT * FROM country ORDER BY country'),
    ]);
    if (!city.rows.length) return res.status(404).render('error', { message: 'City not found', title: 'Not Found', currentPage: 'cities', flash: null });
    res.render('cities/form', {
      title: 'Edit City',
      currentPage: 'cities',
      flash: null,
      city: city.rows[0],
      countries: countries.rows,
      action: `/cities/${req.params.id}?_method=PUT`,
    });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { city, country_id } = req.body;
    await db.query('UPDATE city SET city=$1, country_id=$2, last_update=NOW() WHERE city_id=$3', [city, country_id, req.params.id]);
    res.redirect('/cities?flash=City+updated');
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await db.query('DELETE FROM city WHERE city_id=$1', [req.params.id]);
    res.redirect('/cities?flash=City+deleted');
  } catch (err) { next(err); }
});

// Country management
router.post('/countries', async (req, res, next) => {
  try {
    const { country } = req.body;
    await db.query('INSERT INTO country (country) VALUES ($1)', [country]);
    res.redirect('/cities/new?flash=Country+added');
  } catch (err) { next(err); }
});

module.exports = router;
