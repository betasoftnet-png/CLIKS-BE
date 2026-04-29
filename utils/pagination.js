async function paginate(query, params, page, limit, db) {
  const currentPage = Math.max(1, parseInt(page, 10) || 1);
  const currentLimit = Math.max(1, parseInt(limit, 10) || 10);
  const offset = (currentPage - 1) * currentLimit;

  // Run COUNT(*) using a subquery wrapper to ensure correctness regardless of complex joins
  // PostgreSQL requires an alias for subqueries in the FROM clause
  const countQuery = `SELECT COUNT(*) as total FROM (${query}) AS p_sub`;
  const countStmt = db.prepare(countQuery);
  const totalRow = await countStmt.get(...params);
  const total = Number(totalRow.total);

  // Run the paginated query
  const paginatedQuery = `${query} LIMIT ? OFFSET ?`;
  const paginatedStmt = db.prepare(paginatedQuery);
  const rows = await paginatedStmt.all(...params, currentLimit, offset);

  const totalPages = Math.ceil(total / currentLimit);

  return {
    rows,
    meta: {
      page: currentPage,
      limit: currentLimit,
      total,
      totalPages
    }
  };
}

module.exports = { paginate };
