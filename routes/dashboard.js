const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res, next) => {
  try {
    const [films, customers, openRentals, todayRevenue, recentRentals] = await Promise.all([
      db.query('SELECT COUNT(*) FROM film'),
      db.query('SELECT COUNT(*) FROM customer WHERE activebool = true'),
      db.query('SELECT COUNT(*) FROM rental WHERE return_date IS NULL'),
      db.query("SELECT COALESCE(SUM(amount),0) FROM payment WHERE payment_date::date = CURRENT_DATE"),
      db.query(`
        SELECT r.rental_id, c.first_name || ' ' || c.last_name AS customer,
               f.title, r.rental_date
        FROM rental r
        JOIN customer c ON r.customer_id = c.customer_id
        JOIN inventory i ON r.inventory_id = i.inventory_id
        JOIN film f ON i.film_id = f.film_id
        WHERE r.return_date IS NULL
        ORDER BY r.rental_date DESC
        LIMIT 10
      `),
    ]);

    res.render('index', {
      title: 'Dashboard',
      currentPage: 'dashboard',
      flash: null,
      stats: {
        films: films.rows[0].count,
        customers: customers.rows[0].count,
        openRentals: openRentals.rows[0].count,
        todayRevenue: parseFloat(todayRevenue.rows[0].coalesce).toFixed(2),
      },
      recentRentals: recentRentals.rows,
    });
  } catch (err) { next(err); }
});

module.exports = router;
