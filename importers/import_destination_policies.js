import { existsSync, readFileSync, writeFileSync } from 'fs';
import initSqlJs from 'sql.js';

function getCountryId(db, iso2) {
    if (!iso2) return null;
    // Use UPPERCASE for ISO2 lookup in the DB
    const result = db.exec(`SELECT id FROM countries WHERE iso2 = ?`, [iso2.toUpperCase()]);
    if (result.length && result[0].values.length) {
        return result[0].values[0][0];
    }
    return null;
}

async function importDestinationPolicies() {
    const SQL = await initSqlJs();
    const dbPath = `${process.cwd()}/vacation_planner.db`;

    let db;
    if (existsSync(dbPath)) {
        const buffer = readFileSync(dbPath);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    console.log("--- Starting Policy Import & Verification ---");

    // --- Database Setup (Unchanged) ---
    db.run(`DROP TABLE IF EXISTS destination_visa_policies`);
    db.run(`
        CREATE TABLE IF NOT EXISTS destination_visa_policies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            destination_country_id INTEGER NOT NULL,
            condition_type TEXT NOT NULL,
            condition_value TEXT NOT NULL,
            resulting_requirement TEXT NOT NULL,
            notes TEXT,
            FOREIGN KEY (destination_country_id) REFERENCES countries(id) ON DELETE CASCADE
        )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_destination_policies ON destination_visa_policies(destination_country_id, condition_type, condition_value COLLATE NOCASE)`);

    const SCHENGEN_ISO2 = [
        'AT', 'BE', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
        'IS', 'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL',
        'PT', 'SK', 'SI', 'ES', 'SE', 'CH'
    ];

    // --- Policy Data (Unchanged) ---
    const policies = [
        // ... (All your policy data goes here, including the Schenhen map) ...
        ...SCHENGEN_ISO2.map(iso2 => ({
            destination: iso2,
            type: 'residence_permit',
            value: 'SCHENGEN_RESIDENCE_PERMIT',
            result: 'visa-free',
            notes: 'Schengen residence permit allows visa-free travel throughout the Schengen Area (90 days in 180-day period).'
        })),

        // ... (Explicit MX and PE policies for Schengen Residence Permit) ...
        {
            destination: 'MX',
            type: 'residence_permit',
            value: 'SCHENGEN_RESIDENCE_PERMIT',
            result: 'visa-free',
            notes: 'Valid, unexpired Schengen residence permit grants visa-free entry.'
        },
        {
            destination: 'PE',
            type: 'residence_permit',
            value: 'SCHENGEN_RESIDENCE_PERMIT',
            result: 'visa-free',
            notes: 'Valid residence permit from the Schengen Area.'
        },

        // UK Visa Policies - Countries that allow visa-free entry for UK visa holders
        {
            destination: 'AL', // Albania
            type: 'held_visa',
            value: 'UK',
            result: 'visa-free',
            notes: 'Valid UK visa allows visa-free entry to Albania.'
        },
        {
            destination: 'BA', // Bosnia and Herzegovina
            type: 'held_visa',
            value: 'UK',
            result: 'visa-free',
            notes: 'Valid UK visa allows visa-free entry to Bosnia and Herzegovina.'
        },
        {
            destination: 'ME', // Montenegro
            type: 'held_visa',
            value: 'UK',
            result: 'visa-free',
            notes: 'Valid UK visa allows visa-free entry to Montenegro.'
        },
        {
            destination: 'RS', // Serbia
            type: 'held_visa',
            value: 'UK',
            result: 'visa-free',
            notes: 'Valid UK visa allows visa-free entry to Serbia.'
        },
        {
            destination: 'GE', // Georgia
            type: 'held_visa',
            value: 'UK',
            result: 'visa-free',
            notes: 'Valid UK visa allows visa-free entry to Georgia.'
        },

        // US Visa Policies - Countries that allow visa-free entry for US visa holders
        {
            destination: 'AL', // Albania
            type: 'held_visa',
            value: 'US',
            result: 'visa-free',
            notes: 'Valid US visa allows visa-free entry to Albania.'
        },
        {
            destination: 'ME', // Montenegro
            type: 'held_visa',
            value: 'US',
            result: 'visa-free',
            notes: 'Valid US visa allows visa-free entry to Montenegro.'
        },
        {
            destination: 'RS', // Serbia
            type: 'held_visa',
            value: 'US',
            result: 'visa-free',
            notes: 'Valid US visa allows visa-free entry to Serbia.'
        },
        {
            destination: 'GE', // Georgia
            type: 'held_visa',
            value: 'US',
            result: 'visa-free',
            notes: 'Valid US visa allows visa-free entry to Georgia.'
        },
        {
            destination: 'MX', // Mexico
            type: 'held_visa',
            value: 'US',
            result: 'visa-free',
            notes: 'Valid US visa allows visa-free entry to Mexico.'
        },

        // Schengen Visa Policies - Countries that allow visa-free entry for Schengen visa holders
        {
            destination: 'AL', // Albania
            type: 'held_visa',
            value: 'SCHENGEN',
            result: 'visa-free',
            notes: 'Valid Schengen visa allows visa-free entry to Albania.'
        },
        {
            destination: 'BA', // Bosnia and Herzegovina
            type: 'held_visa',
            value: 'SCHENGEN',
            result: 'visa-free',
            notes: 'Valid Schengen visa allows visa-free entry to Bosnia and Herzegovina.'
        },
        {
            destination: 'ME', // Montenegro
            type: 'held_visa',
            value: 'SCHENGEN',
            result: 'visa-free',
            notes: 'Valid Schengen visa allows visa-free entry to Montenegro.'
        },
        {
            destination: 'RS', // Serbia
            type: 'held_visa',
            value: 'SCHENGEN',
            result: 'visa-free',
            notes: 'Valid Schengen visa allows visa-free entry to Serbia.'
        },
        {
            destination: 'GE', // Georgia
            type: 'held_visa',
            value: 'SCHENGEN',
            result: 'visa-free',
            notes: 'Valid Schengen visa allows visa-free entry to Georgia.'
        },
        {
            destination: 'MX', // Mexico
            type: 'held_visa',
            value: 'SCHENGEN',
            result: 'visa-free',
            notes: 'Valid Schengen visa allows visa-free entry to Mexico.'
        },
        {
            destination: 'TR', // Turkey
            type: 'held_visa',
            value: 'SCHENGEN',
            result: 'e-visa',
            notes: 'Valid Schengen visa allows e-visa for Turkey.'
        },
        {
            destination: 'PA', // Panama
            type: 'held_visa',
            value: 'SCHENGEN',
            result: 'visa-free',
            notes: 'Valid Schengen visa allows visa-free entry to Panama.'
        }
    ];

    // --- Data Insertion ---
    db.run('BEGIN TRANSACTION');
    let insertedCount = 0;
    try {
        for (const policy of policies) {
            const destId = getCountryId(db, policy.destination);

            if (destId) {
                db.run(
                    `INSERT INTO destination_visa_policies 
                     (destination_country_id, condition_type, condition_value, resulting_requirement, notes) 
                     VALUES (?, ?, ?, ?, ?)`,
                    [destId, policy.type, policy.value.toUpperCase(), policy.result, policy.notes]
                );
                insertedCount++;
            } else {
                console.warn(`⚠️ Country ID not found for destination: ${policy.destination}. Skipping policy.`);
            }
        }
        db.run('COMMIT');
        console.log(`✅ Successfully inserted ${insertedCount} policies.`);

        // --- DATA VERIFICATION STEP ---
        console.log(`\n--- Verification: Checking SCHENGEN_RESIDENCE_PERMIT policies ---`);

        const verificationQuery = `
            SELECT T2.iso2 
            FROM destination_visa_policies T1
            JOIN countries T2 ON T1.destination_country_id = T2.id
            WHERE T1.condition_value = 'SCHENGEN_RESIDENCE_PERMIT'
        `;

        const verificationResult = db.exec(verificationQuery);

        if (verificationResult.length && verificationResult[0].values.length) {
            const verifiedCountries = verificationResult[0].values.map(row => row[0]);

            const checks = [
                { code: 'MX', name: 'Mexico' },
                { code: 'PE', name: 'Peru' },
                { code: 'DE', name: 'Germany' }
            ];

            let allVerified = true;
            for (const check of checks) {
                if (verifiedCountries.includes(check.code)) {
                    console.log(`   [PASS] ${check.name} policy found.`);
                } else {
                    console.error(`   [FAIL] ${check.name} policy NOT found! ID: ${getCountryId(db, check.code)}`);
                    allVerified = false;
                }
            }

            if (allVerified) {
                console.log(`\n✅ Verification successful! Critical policies are present.`);
            } else {
                console.error(`\n❌ Verification failed. Check logs for missing countries.`);
            }

        } else {
            console.error(`\n❌ Verification failed! No policies found for SCHENGEN_RESIDENCE_PERMIT.`);
        }

        // --- End Verification ---

    } catch (e) {
        db.run('ROLLBACK');
        console.error('❌ Failed to import policies during transaction:', e);
    }


    writeFileSync(dbPath, Buffer.from(db.export()));
    console.log(`--- Database saved to ${dbPath} ---`);
}

importDestinationPolicies().catch((e) => {
    console.error(e);
    process.exit(1);
});