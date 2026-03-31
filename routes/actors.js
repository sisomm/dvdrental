const express = require('express');
const router = express.Router();
const db = require('../db');

// List
router.get('/', async (req, res, next) => {
  try {
    const { search, page = 1 } = req.query;
    const limit = 30;
    const offset = (page - 1) * limit;
    const params = [];
    const conditions = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(a.first_name || ' ' || a.last_name ILIKE $${params.length})`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const [actors, count] = await Promise.all([
      db.query(`
        SELECT a.actor_id, a.first_name, a.last_name, COUNT(fa.film_id) AS film_count
        FROM actor a
        LEFT JOIN film_actor fa ON a.actor_id = fa.actor_id
        ${where}
        GROUP BY a.actor_id
        ORDER BY a.last_name, a.first_name
        LIMIT ${limit} OFFSET ${offset}
      `, params),
      db.query(`SELECT COUNT(*) FROM actor a ${where}`, params),
    ]);

    res.render('actors/index', {
      title: 'Actors',
      currentPage: 'actors',
      flash: req.query.flash ? { type: req.query.flashType || 'info', message: req.query.flash } : null,
      actors: actors.rows,
      totalPages: Math.ceil(count.rows[0].count / limit),
      page: parseInt(page),
      query: req.query,
    });
  } catch (err) { next(err); }
});

// New form
router.get('/new', (req, res) => {
  res.render('actors/form', {
    title: 'New Actor',
    currentPage: 'actors',
    flash: null,
    actor: {},
    action: '/actors',
  });
});

// Create
router.post('/', async (req, res, next) => {
  try {
    const { first_name, last_name } = req.body;
    const result = await db.query(
      'INSERT INTO actor (first_name, last_name) VALUES ($1, $2) RETURNING actor_id',
      [first_name.trim().toUpperCase(), last_name.trim().toUpperCase()]
    );
    res.redirect(`/actors?flash=Actor+added+successfully`);
  } catch (err) { next(err); }
});

// Edit form
router.get('/:id/edit', async (req, res, next) => {
  try {
    const actor = await db.query('SELECT * FROM actor WHERE actor_id=$1', [req.params.id]);
    if (!actor.rows.length) return res.status(404).render('error', { message: 'Actor not found', title: 'Not Found', currentPage: 'actors', flash: null });
    res.render('actors/form', {
      title: 'Edit Actor',
      currentPage: 'actors',
      flash: null,
      actor: actor.rows[0],
      action: `/actors/${req.params.id}?_method=PUT`,
    });
  } catch (err) { next(err); }
});

// Update
router.put('/:id', async (req, res, next) => {
  try {
    const { first_name, last_name } = req.body;
    await db.query(
      'UPDATE actor SET first_name=$1, last_name=$2, last_update=NOW() WHERE actor_id=$3',
      [first_name.trim().toUpperCase(), last_name.trim().toUpperCase(), req.params.id]
    );
    res.redirect(`/actors?flash=Actor+updated+successfully`);
  } catch (err) { next(err); }
});

// Delete
router.delete('/:id', async (req, res, next) => {
  try {
    await db.query('DELETE FROM film_actor WHERE actor_id=$1', [req.params.id]);
    await db.query('DELETE FROM actor WHERE actor_id=$1', [req.params.id]);
    res.redirect('/actors?flash=Actor+deleted');
  } catch (err) { next(err); }
});

module.exports = router;
