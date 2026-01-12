const fs = require('fs');
const csv = require('csv-parser');
const Database = require('better-sqlite3');
const path = require('path');

// Database path
const DB_PATH = path.join(__dirname, '../data/legal_cases.db');
const TSV_PATH = path.join(__dirname, '../data/legal_cases_2020_2025.tsv');

console.log('🔧 Initializing SQLite database...');

// Delete existing database to start fresh
if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
    console.log('✅ Removed existing database');
}

// Create new database
const db = new Database(DB_PATH);
console.log('✅ Created new database at:', DB_PATH);

// Create schema
console.log('📊 Creating database schema...');

db.exec(`
  -- Main cases table
  CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    year INTEGER,
    court TEXT,
    category TEXT,
    url TEXT,
    key_holding TEXT,
    legal_sections TEXT,
    practical_takeaway TEXT,
    keywords TEXT
  );

  -- Indexes for performance
  CREATE INDEX IF NOT EXISTS idx_category ON cases(category);
  CREATE INDEX IF NOT EXISTS idx_year ON cases(year);

  -- Full-Text Search (FTS5) virtual table
  CREATE VIRTUAL TABLE IF NOT EXISTS cases_fts USING fts5(
    title,
    key_holding,
    practical_takeaway,
    keywords,
    category,
    content='cases',
    content_rowid='rowid'
  );

  -- Trigger to keep FTS in sync with main table
  CREATE TRIGGER IF NOT EXISTS cases_ai AFTER INSERT ON cases BEGIN
    INSERT INTO cases_fts(rowid, title, key_holding, practical_takeaway, keywords, category)
    VALUES (new.rowid, new.title, new.key_holding, new.practical_takeaway, new.keywords, new.category);
  END;

  CREATE TRIGGER IF NOT EXISTS cases_ad AFTER DELETE ON cases BEGIN
    DELETE FROM cases_fts WHERE rowid = old.rowid;
  END;

  CREATE TRIGGER IF NOT EXISTS cases_au AFTER UPDATE ON cases BEGIN
    UPDATE cases_fts 
    SET title = new.title,
        key_holding = new.key_holding,
        practical_takeaway = new.practical_takeaway,
        keywords = new.keywords,
        category = new.category
    WHERE rowid = new.rowid;
  END;
`);

console.log('✅ Schema created successfully');

// Helper function to extract keywords from case data
function extractKeywords(row) {
    const text = [
        row.title || '',
        row.key_holding || '',
        row.practical_takeaway || '',
        row.category || '',
        row.legal_sections || ''
    ].join(' ').toLowerCase();

    // Remove special characters and extract words
    const words = text
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 3) // Only words longer than 3 chars
        .filter(word => !isStopWord(word)); // Remove common stop words

    // Return unique keywords
    return [...new Set(words)].slice(0, 100).join(' ');
}

// Simple stop words list (common words with low search value)
function isStopWord(word) {
    const stopWords = new Set([
        'this', 'that', 'with', 'from', 'have', 'been', 'were', 'their',
        'there', 'where', 'which', 'these', 'those', 'will', 'would', 'could',
        'should', 'about', 'after', 'before', 'under', 'over', 'such', 'also'
    ]);
    return stopWords.has(word);
}

// Prepare insert statement
const insertCase = db.prepare(`
  INSERT OR REPLACE INTO cases (
    id, title, year, court, category, url, 
    key_holding, legal_sections, practical_takeaway, keywords
  ) VALUES (
    @id, @title, @year, @court, @category, @url,
    @key_holding, @legal_sections, @practical_takeaway, @keywords
  )
`);

// Batch insert for performance
const insertMany = db.transaction((cases) => {
    for (const caseData of cases) {
        insertCase.run(caseData);
    }
});

// Parse and import TSV
console.log('📂 Reading TSV file:', TSV_PATH);

const cases = [];
let rowCount = 0;

fs.createReadStream(TSV_PATH)
    .pipe(csv({ separator: '\t' })) // TSV uses tab separator
    .on('data', (row) => {
        rowCount++;

        // Transform and validate data
        const caseData = {
            id: row.case_id || `case_${Date.now()}_${rowCount}`,
            title: row.title || 'Untitled Case',
            year: parseInt(row.year) || null,
            court: row.court || '',
            category: row.category || 'General',
            url: row.url || '',
            key_holding: row.key_holding || '',
            legal_sections: row.legal_sections || '',
            practical_takeaway: row.practical_takeaway || '',
            keywords: '' // Will be set below
        };

        // Extract searchable keywords
        caseData.keywords = extractKeywords(caseData);

        cases.push(caseData);

        // Batch insert every 50 rows for optimal performance
        if (cases.length >= 50) {
            insertMany(cases);
            console.log(`  ✅ Inserted ${rowCount} cases...`);
            cases.length = 0; // Clear array
        }
    })
    .on('end', () => {
        // Insert remaining cases
        if (cases.length > 0) {
            insertMany(cases);
        }

        console.log(`\n🎉 Import complete!`);
        console.log(`   Total cases imported: ${rowCount}`);

        // Verify import
        const count = db.prepare('SELECT COUNT(*) as count FROM cases').get();
        const ftsCount = db.prepare('SELECT COUNT(*) as count FROM cases_fts').get();

        console.log(`   Cases in main table: ${count.count}`);
        console.log(`   Cases in FTS table: ${ftsCount.count}`);

        // Show database size
        const stats = fs.statSync(DB_PATH);
        console.log(`   Database size: ${(stats.size / 1024).toFixed(2)}KB`);

        // Sample query to verify FTS works
        console.log(`\n🧪 Testing FTS query for "arrest warrant"...`);
        const testResults = db.prepare(`
      SELECT c.id, c.title, rank
      FROM cases_fts
      JOIN cases c ON cases_fts.rowid = c.rowid
      WHERE cases_fts MATCH 'arrest warrant'
      ORDER BY rank
      LIMIT 3
    `).all();

        console.log(`   Found ${testResults.length} matches:`);
        testResults.forEach((result, i) => {
            console.log(`   ${i + 1}. ${result.id}: ${result.title.substring(0, 60)}...`);
        });

        // Close database
        db.close();
        console.log(`\n✅ Database ready at: ${DB_PATH}`);
        console.log(`🚀 You can now run: npm start`);
    })
    .on('error', (err) => {
        console.error('❌ Error reading TSV file:', err);
        process.exit(1);
    });
