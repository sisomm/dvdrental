require('dotenv').config();
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const methodOverride = require('method-override');
const path = require('path');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', require('./routes/dashboard'));
app.use('/films', require('./routes/films'));
app.use('/customers', require('./routes/customers'));
app.use('/rentals', require('./routes/rentals'));
app.use('/staff', require('./routes/staff'));
app.use('/stores', require('./routes/stores'));
app.use('/cities', require('./routes/cities'));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { message: err.message, title: 'Error', currentPage: '', flash: null });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Blockbuster is OPEN! http://localhost:${PORT}`));
