app.locals.pool = pool;
app.use(express.json({ limit: '2mb' }));

app.use(require('./routes/health'));
app.use(require('./routes/product'));
app.use(require('./routes/cart'));
app.use(require('./routes/order'));
app.use(require('./routes/cs'));
