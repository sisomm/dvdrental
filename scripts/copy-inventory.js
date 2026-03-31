require('dotenv').config();
const db = require('../db');

async function main() {
  const sourceStoreId = 1;

  // Find the Trollåsen store
  const storeRes = await db.query(`
    SELECT st.store_id FROM store st
    JOIN address a ON st.address_id = a.address_id
    JOIN city ci ON a.city_id = ci.city_id
    WHERE ci.city ILIKE $1
  `, ['Trollåsen']);

  if (!storeRes.rows.length) {
    console.error('Could not find a store in Trollåsen.');
    process.exit(1);
  }

  const targetStoreId = storeRes.rows[0].store_id;
  console.log(`Copying inventory from store ${sourceStoreId} → store ${targetStoreId} (Trollåsen)`);

  // Get all distinct films in store 1
  const films = await db.query(
    'SELECT DISTINCT film_id FROM inventory WHERE store_id = $1 ORDER BY film_id',
    [sourceStoreId]
  );

  console.log(`Found ${films.rows.length} distinct films in store ${sourceStoreId}`);

  for (const { film_id } of films.rows) {
    await db.query(
      'INSERT INTO inventory (film_id, store_id) VALUES ($1, $2)',
      [film_id, targetStoreId]
    );
  }

  console.log(`Done — added ${films.rows.length} copies to the Trollåsen store.`);
  process.exit(0);
}

main().catch(err => { console.error(err.message); process.exit(1); });
