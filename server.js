const express = require('express');
const cors = require('cors');
const app = express();
app.use(express.json());
app.use(cors());

const CASES = [
  {
    id: "case_011",
    title: "Mihir Rajesh Shah v. State of Maharashtra",
    year: 2025,
    holding: "Every person arrested must get written grounds of arrest in their language",
    category: "False Arrest",
    url: "https://api.sci.gov.in/supremecourt/2025/"
  },
  {
    id: "case_012",
    title: "Vihaan Kumar v. State of Haryana",
    year: 2025,
    holding: "No credible information = no valid arrest",
    category: "False Arrest",
    url: "https://indiankanoon.org/doc/"
  },
  {
    id: "case_013",
    title: "Prabir Purkayastha v. State of Delhi",
    year: 2025,
    holding: "Article 22(1) violation vitiates entire arrest",
    category: "False Arrest",
    url: "https://indiankanoon.org/doc/"
  }
];

const PATTERNS = [
  { id: "p1", name: "NO WARRANT", indicator: "Refuses to show FIR", counter: "Demand written grounds", severity: "CRITICAL", case: "case_011" },
  { id: "p2", name: "EXTORTION", indicator: "Officer asks for cash", counter: "File FIR Sec 170 BNS", severity: "CRITICAL", case: "case_012" },
  { id: "p3", name: "UNNECESSARY ADJOURNMENTS", indicator: "5+ postponements", counter: "Demand case action plan", severity: "HIGH", case: "case_001" }
];

app.post('/api/query', (req, res) => {
  res.json({
    disclaimer: "⚠️ NOT LEGAL ADVICE",
    process: {
      steps: [
        { step: 1, action: "Remain silent", basis: "Article 20(3)" },
        { step: 2, action: "Demand written grounds", basis: "Article 22(1)" },
        { step: 3, action: "Request magistrate inspection", basis: "Article 22(2)" },
        { step: 4, action: "CONSULT LAWYER", basis: "Mandatory" }
      ]
    },
    scamFlags: PATTERNS.map(p => ({ name: p.name, indicator: p.indicator, counter: p.counter, severity: p.severity })),
    sources: CASES.slice(0, 3).map(c => ({ title: c.title, year: c.year, holding: c.holding, url: c.url })),
    auditId: `audit_${Date.now()}`
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(3001, () => console.log('✅ Legal SaaS MVP on http://localhost:3001'));
