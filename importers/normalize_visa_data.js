import { existsSync, readFileSync, writeFileSync } from 'fs';
import initSqlJs from 'sql.js';

async function normalizeVisaData() {
    const SQL = await initSqlJs();
    const dbPath = `${process.cwd()}/vacation_planner.db`;

    if (!existsSync(dbPath)) {
        console.error('Database not found');
        return;
    }

    const buffer = readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    function normalizeRequirement(req) {
        if (!req) return 'visa required';
        const r = req.toLowerCase().trim();
        
        // Handle numeric values (days allowed) as visa-free
        if (!isNaN(r)) return 'visa-free';
        
        if (r === 'visa-free' || r === 'visa free' || r === 'no visa required') return 'visa-free';
        if (r === 'visa on arrival' || r === 'visa-on-arrival') return 'visa-on-arrival';
        if (r === 'e-visa' || r === 'evisa') return 'e-visa';
        return 'visa required';
    }

    // Get all visa requirements
    const result = db.exec(`SELECT id, requirement FROM visa_requirements`);
    
    if (!result.length || !result[0].values.length) {
        console.log('No visa requirements found');
        return;
    }

    let updated = 0;
    for (const [id, requirement] of result[0].values) {
        const normalized = normalizeRequirement(requirement);
        
        if (normalized !== requirement) {
            db.run(
                `UPDATE visa_requirements SET requirement = ? WHERE id = ?`,
                [normalized, id]
            );
            updated++;
        }
    }

    writeFileSync(dbPath, Buffer.from(db.export()));
    console.log(`✅ Normalized ${updated} visa requirements`);
}

normalizeVisaData().catch((e) => {
    console.error(e);
    process.exit(1);
});