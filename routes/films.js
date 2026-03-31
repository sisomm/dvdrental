const express = require('express');
const router = express.Router();
const db = require('../db');

// List
router.get('/', async (req, res, next) => {
  try {
    const { search, category, rating, page = 1 } = req.query;
    const limit = 25;
    const offset = (page - 1) * limit;
    const params = [];
    const conditions = [];

    if (search) { params.push(`%${search}%`); conditions.push(`f.title ILIKE $${params.length}`); }
    if (category) { params.push(category); conditions.push(`cat.category_id = $${params.length}`); }
    if (rating) { params.push(rating); conditions.push(`f.rating = $${params.length}::mpaa_rating`); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const filmsQ = db.query(`
      SELECT f.film_id, f.title, f.rating, f.rental_rate, f.length,
             l.name AS language,
             STRING_AGG(DISTINCT cat.name, ', ' ORDER BY cat.name) AS categories,
             COUNT(DISTINCT i.inventory_id) AS copies,
             COUNT(DISTINCT r.rental_id) FILTER (WHERE r.return_date IS NULL) AS rented_out
      FROM film f
      LEFT JOIN language l ON f.language_id = l.language_id
      LEFT JOIN film_category fc ON f.film_id = fc.film_id
      LEFT JOIN category cat ON fc.category_id = cat.category_id
      LEFT JOIN inventory i ON f.film_id = i.film_id
      LEFT JOIN rental r ON i.inventory_id = r.inventory_id AND r.return_date IS NULL
      ${where}
      GROUP BY f.film_id, l.name
      ORDER BY f.title
      LIMIT ${limit} OFFSET ${offset}
    `, params);

    const countQ = db.query(`
      SELECT COUNT(DISTINCT f.film_id)
      FROM film f
      LEFT JOIN film_category fc ON f.film_id = fc.film_id
      LEFT JOIN category cat ON fc.category_id = cat.category_id
      ${where}
    `, params);

    const categoriesQ = db.query('SELECT * FROM category ORDER BY name');
    const [films, count, categories] = await Promise.all([filmsQ, countQ, categoriesQ]);
    const totalPages = Math.ceil(count.rows[0].count / limit);

    res.render('films/index', {
      title: 'Films',
      currentPage: 'films',
      flash: req.query.flash ? { type: req.query.flashType || 'info', message: req.query.flash } : null,
      films: films.rows,
      categories: categories.rows,
      totalPages,
      page: parseInt(page),
      query: req.query,
    });
  } catch (err) { next(err); }
});

// New form
router.get('/new', async (req, res, next) => {
  try {
    const [languages, categories, actors] = await Promise.all([
      db.query('SELECT * FROM language ORDER BY name'),
      db.query('SELECT * FROM category ORDER BY name'),
      db.query('SELECT actor_id, first_name || \' \' || last_name AS name FROM actor ORDER BY last_name, first_name'),
    ]);
    res.render('films/form', {
      title: 'New Film',
      currentPage: 'films',
      flash: null,
      film: {},
      selectedActors: [],
      selectedCategories: [],
      languages: languages.rows,
      categories: categories.rows,
      actors: actors.rows,
      action: '/films',
      method: 'POST',
    });
  } catch (err) { next(err); }
});

// Create
router.post('/', async (req, res, next) => {
  try {
    const { title, description, release_year, language_id, rental_duration, rental_rate,
            length, replacement_cost, rating, actor_ids, category_ids } = req.body;

    const result = await db.query(`
      INSERT INTO film (title, description, release_year, language_id, rental_duration,
                        rental_rate, length, replacement_cost, rating, fulltext)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::mpaa_rating, to_tsvector($10 || ' ' || COALESCE($11,'')))
      RETURNING film_id
    `, [title, description, release_year || null, language_id, rental_duration || 3,
        rental_rate || 4.99, length || null, replacement_cost || 19.99, rating || 'G', title, description || '']);

    const filmId = result.rows[0].film_id;

    if (actor_ids) {
      const ids = Array.isArray(actor_ids) ? actor_ids : [actor_ids];
      for (const id of ids) {
        await db.query('INSERT INTO film_actor (film_id, actor_id) VALUES ($1,$2)', [filmId, id]);
      }
    }
    if (category_ids) {
      const ids = Array.isArray(category_ids) ? category_ids : [category_ids];
      for (const id of ids) {
        await db.query('INSERT INTO film_category (film_id, category_id) VALUES ($1,$2)', [filmId, id]);
      }
    }

    res.redirect(`/films/${filmId}?flash=Film+added+successfully`);
  } catch (err) { next(err); }
});

// Detail
router.get('/:id', async (req, res, next) => {
  try {
    const [film, actors, categories, availability, inventory, stores] = await Promise.all([
      db.query(`
        SELECT f.*, l.name AS language_name
        FROM film f LEFT JOIN language l ON f.language_id = l.language_id
        WHERE f.film_id = $1
      `, [req.params.id]),
      db.query(`
        SELECT a.actor_id, a.first_name || ' ' || a.last_name AS name
        FROM actor a JOIN film_actor fa ON a.actor_id = fa.actor_id
        WHERE fa.film_id = $1 ORDER BY a.last_name
      `, [req.params.id]),
      db.query(`
        SELECT c.name FROM category c JOIN film_category fc ON c.category_id = fc.category_id
        WHERE fc.film_id = $1 ORDER BY c.name
      `, [req.params.id]),
      db.query(`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN r.return_date IS NULL THEN 1 ELSE 0 END) AS rented
        FROM inventory i
        LEFT JOIN rental r ON i.inventory_id = r.inventory_id AND r.return_date IS NULL
        WHERE i.film_id = $1
      `, [req.params.id]),
      db.query(`
        SELECT i.inventory_id, i.store_id,
               (SELECT COUNT(*) FROM rental r WHERE r.inventory_id = i.inventory_id AND r.return_date IS NULL) > 0 AS is_rented
        FROM inventory i
        WHERE i.film_id = $1
        ORDER BY i.store_id, i.inventory_id
      `, [req.params.id]),
      db.query('SELECT st.store_id, ci.city FROM store st JOIN address a ON st.address_id = a.address_id JOIN city ci ON a.city_id = ci.city_id ORDER BY st.store_id'),
    ]);

    if (!film.rows.length) return res.status(404).render('error', { message: 'Film not found', title: 'Not Found', currentPage: 'films', flash: null });

    res.render('films/detail', {
      title: film.rows[0].title,
      currentPage: 'films',
      flash: req.query.flash ? { type: req.query.flashType || 'info', message: req.query.flash } : null,
      film: film.rows[0],
      actors: actors.rows,
      categories: categories.rows,
      availability: availability.rows[0],
      inventory: inventory.rows,
      stores: stores.rows,
    });
  } catch (err) { next(err); }
});

// Add inventory copy
router.post('/:id/inventory', async (req, res, next) => {
  try {
    const { store_id } = req.body;
    await db.query('INSERT INTO inventory (film_id, store_id) VALUES ($1, $2)', [req.params.id, store_id]);
    res.redirect(`/films/${req.params.id}?flash=Copy+added+to+store+${store_id}&flashType=info`);
  } catch (err) { next(err); }
});

// Remove inventory copy
router.delete('/:id/inventory/:inventory_id', async (req, res, next) => {
  try {
    const rented = await db.query(
      'SELECT 1 FROM rental WHERE inventory_id=$1 AND return_date IS NULL',
      [req.params.inventory_id]
    );
    if (rented.rows.length) {
      return res.redirect(`/films/${req.params.id}?flash=Cannot+remove+a+copy+that+is+currently+rented+out&flashType=error`);
    }
    await db.query('DELETE FROM inventory WHERE inventory_id=$1 AND film_id=$2', [req.params.inventory_id, req.params.id]);
    res.redirect(`/films/${req.params.id}?flash=Copy+removed&flashType=info`);
  } catch (err) { next(err); }
});

// Edit form
router.get('/:id/edit', async (req, res, next) => {
  try {
    const [film, languages, categories, actors, selectedActors, selectedCategories] = await Promise.all([
      db.query('SELECT * FROM film WHERE film_id = $1', [req.params.id]),
      db.query('SELECT * FROM language ORDER BY name'),
      db.query('SELECT * FROM category ORDER BY name'),
      db.query('SELECT actor_id, first_name || \' \' || last_name AS name FROM actor ORDER BY last_name, first_name'),
      db.query('SELECT actor_id FROM film_actor WHERE film_id = $1', [req.params.id]),
      db.query('SELECT category_id FROM film_category WHERE film_id = $1', [req.params.id]),
    ]);

    if (!film.rows.length) return res.status(404).render('error', { message: 'Film not found', title: 'Not Found', currentPage: 'films', flash: null });

    res.render('films/form', {
      title: 'Edit Film',
      currentPage: 'films',
      flash: null,
      film: film.rows[0],
      selectedActors: selectedActors.rows.map(r => r.actor_id),
      selectedCategories: selectedCategories.rows.map(r => r.category_id),
      languages: languages.rows,
      categories: categories.rows,
      actors: actors.rows,
      action: `/films/${req.params.id}?_method=PUT`,
      method: 'POST',
    });
  } catch (err) { next(err); }
});

// Update
router.put('/:id', async (req, res, next) => {
  try {
    const { title, description, release_year, language_id, rental_duration, rental_rate,
            length, replacement_cost, rating, actor_ids, category_ids } = req.body;
    const id = req.params.id;

    await db.query(`
      UPDATE film SET title=$1, description=$2, release_year=$3, language_id=$4,
        rental_duration=$5, rental_rate=$6, length=$7, replacement_cost=$8,
        rating=$9::mpaa_rating, last_update=NOW(),
        fulltext=to_tsvector($11 || ' ' || COALESCE($12,''))
      WHERE film_id=$10
    `, [title, description, release_year || null, language_id, rental_duration || 3,
        rental_rate, length || null, replacement_cost, rating || 'G', id, title, description || '']);

    await db.query('DELETE FROM film_actor WHERE film_id=$1', [id]);
    await db.query('DELETE FROM film_category WHERE film_id=$1', [id]);

    if (actor_ids) {
      const ids = Array.isArray(actor_ids) ? actor_ids : [actor_ids];
      for (const aid of ids) {
        await db.query('INSERT INTO film_actor (film_id, actor_id) VALUES ($1,$2)', [id, aid]);
      }
    }
    if (category_ids) {
      const ids = Array.isArray(category_ids) ? category_ids : [category_ids];
      for (const cid of ids) {
        await db.query('INSERT INTO film_category (film_id, category_id) VALUES ($1,$2)', [id, cid]);
      }
    }

    res.redirect(`/films/${id}?flash=Film+updated+successfully`);
  } catch (err) { next(err); }
});

// Delete
router.delete('/:id', async (req, res, next) => {
  try {
    await db.query('DELETE FROM film_actor WHERE film_id=$1', [req.params.id]);
    await db.query('DELETE FROM film_category WHERE film_id=$1', [req.params.id]);
    await db.query('DELETE FROM film WHERE film_id=$1', [req.params.id]);
    res.redirect('/films?flash=Film+deleted');
  } catch (err) { next(err); }
});

module.exports = router;
