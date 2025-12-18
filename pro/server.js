

const express = require('express');               //jo me ne download kia ose idhr require kia
const mysql = require('mysql2/promise');          //promise cheezon ko asynchronus way me run krta hai mtlb jb tk vo nhi chlaeg ga baqi cheezen fetch hoti rhen gi

const cors = require('cors');
const path = require('path');

const app = express();
const port = 3000;


const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = '123';

app.use(cors());
app.use(express.json());            //express json se hm json data ko receive krte hain
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'frontend')));

// EJS reports directory
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'reports'));


const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT
});

console.log("MySQL pool created");




//jb me ne debug kia apni file ko to mera link double /report/ de rha tha to is function se me ne double copy ko remove kr dia hai
//agr koi link nhi ya to vo row return kr de ga or agr link aya to vo ose clean kr de ga 
//ye ko \?/ hai ye optional \ ko show kr rha hai k report beech me ho bhi skti hain ya nhi bhi ho skti hain

function normalizeDocumentLink(row) {
  if (!row || !row.document_link) return row;
  let clean = row.document_link.replace(/\/?reports\/?/g, "");
  row.document_link = "/reports/" + clean;
  return row;
}

function ensureReportPath(link) {
  if (!link) return link;
  if (!link.startsWith('/reports/')) return '/reports/' + link.replace(/^\/+/, '');
  return link;
}


//finding random values for report 

function randFloat(min, max, decimals = 1) {
  const v = Math.random() * (max - min) + min;
  return Number(v.toFixed(decimals));
}

//using these to dynamically chnage the test names

const TEST_DEFINITIONS = {
  "CBC": {          //creating an object 
    displayName: "Complete Blood Count (CBC)",      //main entity
    fields: [
      { name: "Hemoglobin", unit: "g/dL", refLow: 12, refHigh: 16 },      //array
      { name: "RBC", unit: "Million/µL", refLow: 4.0, refHigh: 5.5 },
      { name: "WBC", unit: "×10^3/µL", refLow: 4.0, refHigh: 11.0 },
      { name: "Platelets", unit: "×10^3/µL", refLow: 150, refHigh: 450 }
    ]
  },
  "Liver Function Test": {
    displayName: "Liver Function Test (LFT)",
    fields: [
      { name: "ALT (SGPT)", unit: "U/L", refLow: 7, refHigh: 56 },
      { name: "AST (SGOT)", unit: "U/L", refLow: 10, refHigh: 40 },
      { name: "Alkaline Phosphatase", unit: "U/L", refLow: 44, refHigh: 147 },
      { name: "Bilirubin Total", unit: "mg/dL", refLow: 0.1, refHigh: 1.2 }
    ]
  },
  "Thyroid Panel": {
    displayName: "Thyroid Panel",
    fields: [
      { name: "TSH", unit: "µIU/mL", refLow: 0.4, refHigh: 4.0 },
      { name: "Free T3", unit: "pg/mL", refLow: 2.3, refHigh: 4.2 },
      { name: "Free T4", unit: "ng/dL", refLow: 0.9, refHigh: 1.7 }
    ]
  },
  "Blood Glucose": {
    displayName: "Blood Glucose",
    fields: [
      { name: "Fasting Glucose", unit: "mg/dL", refLow: 70, refHigh: 100 },
      { name: "Random Glucose", unit: "mg/dL", refLow: 70, refHigh: 140 }
    ]
  },
  "Urinalysis": {
    displayName: "Urinalysis",
    fields: [
      { name: "Appearance", refText: "Clear" },
      { name: "pH", unit: "", refLow: 5, refHigh: 8 },
      { name: "Protein", refText: "Negative" },
      { name: "Glucose", refText: "Negative" }
    ]
  }
};


//test definitions ko use kr k hm ne dynamically created new arrays ko store kia hai 

function generateResultsForTest(testName) {
  const def = TEST_DEFINITIONS[testName];
  if (!def) return null;
  const results = def.fields.map(f => {
    if (f.refText) {
      return {
        name: f.name,
        value: f.refText,
        unit: f.unit || '',
        reference: f.refText
      };
    } else if (typeof f.refLow === 'number' && typeof f.refHigh === 'number') {
      const low = Number(f.refLow);
      const high = Number(f.refHigh);
      const spread = (high - low) || Math.max(1, low * 0.1);
      const value = randFloat(Math.max(0, low - spread * 0.1), high + spread * 0.1, 1);
      return {
        name: f.name,
        value,
        unit: f.unit || '',
        reference: `${low} - ${high}`
      };
    } else {
      return {
        name: f.name,
        value: "N/A",
        unit: f.unit || '',
        reference: "N/A"
      };
    }
  });
  return { displayName: def.displayName || testName, fields: results };
}


// APIs


app.get('/', (req, res) => {
  const fp = path.join(__dirname, 'frontend', 'homePage.html');
  return res.sendFile(fp);
});


// Patients

app.post('/api/patients', async (req, res) => {         //call back fucntion 
  const { name, gender, age, phone, address, password } = req.body;
  if (!name || !gender || !age || !phone || !address || !password) {
    return res.status(400).json({ message: "All fields required" });
  }
  try {
    const q = `INSERT INTO patients (name, gender, age, phone, address, password, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)`;
    const [r] = await pool.execute(q, [name, gender, age, phone, address, password]);
    res.json({ message: "Patient registered", patientId: r.insertId });
  } catch (err) {
    console.error("PATIENT REGISTER ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});

app.post('/api/patients/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ message: "Phone and Password required" });
  try {
    const q = `SELECT patient_id, name, gender, age, address, phone FROM patients WHERE phone = ? AND password = ? AND is_active = 1`;
    const [rows] = await pool.execute(q, [phone, password]);
    if (rows.length === 0) return res.status(401).json({ message: "Invalid credentials" });     //rows.length == 0 tb ho ga jb 1 bhi row return nhi ho gi
    res.json({ message: "OK", patient: rows[0] });    //kyon k aik hi row return ho gi is lie row[0]
  } catch (err) {
    console.error("PATIENT LOGIN ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});


// Doctors 

app.post('/api/doctors', async (req, res) => {
  const { name, specialization, phone, email, password, department_id = null } = req.body;
  if (!name || !specialization || !phone || !email || !password) {
    return res.status(400).json({ message: "Missing fields" });
  }
  try {
    const q = `INSERT INTO doctors (name, specialization, phone, email, department_id, password, isActive) VALUES (?, ?, ?, ?, ?, ?, 1)`;
    const [r] = await pool.execute(q, [name, specialization, phone, email, department_id, password]);
    res.json({ message: "Doctor added", doctorId: r.insertId });
  } catch (err) {
    console.error("DOCTOR ADD ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});

app.post('/api/doctors/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: "Email and password required" });
  try {
    const q = `SELECT doctor_id, name, specialization, email FROM doctors WHERE email = ? AND password = ? AND isActive = 1`;
    const [rows] = await pool.execute(q, [email, password]);
    if (!rows.length) return res.status(401).json({ message: "Invalid credentials" });
    res.json({ message: "OK", doctor: rows[0] });
  } catch (err) {
    console.error("DOC LOGIN ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});


app.get('/api/doctors', async (req, res) => {
  try {
    const q = `SELECT doctor_id, name, specialization, email, phone FROM doctors WHERE isActive = 1`;
    const [rows] = await pool.execute(q);
    res.json(rows);
  } catch (err) {
    console.error("GET DOCTORS ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});


app.delete('/api/doctors/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const q = `UPDATE doctors SET isActive = 0 WHERE doctor_id = ?`;
    const [r] = await pool.execute(q, [id]);
    if (r.affectedRows === 0) return res.status(404).json({ message: "Doctor not found" });
    res.json({ message: "Doctor deactivated successfully" });
  } catch (err) {
    console.error("SOFT DELETE DOCTOR ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});


// Appointments

app.post('/api/appointments', async (req, res) => {
  const { patientId, patientName, gender, age, address, phone, doctorId, date, notes } = req.body;
  try {
    const q = `INSERT INTO appointments (patient_id, patientName, gender, age, address, phone, doctor_id, date, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')`;
    const [r] = await pool.execute(q, [patientId, patientName, gender, age, address, phone, doctorId, date, notes]);
    res.json({ message: "Appointment booked", appointmentId: r.insertId });
  } catch (err) {
    console.error("BOOK APPT ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});

//previous appointemts in patient , phone number k through all appointmnts se filter kre ga 
app.get('/api/appointments/patient/:phone', async (req, res) => {
  const phone = req.params.phone;
  try {
    const q = `SELECT a.*, d.name AS doctorName, d.specialization FROM appointments a JOIN doctors d ON d.doctor_id = a.doctor_id WHERE a.phone = ? AND d.isActive = 1 ORDER BY a.date DESC`;
    const [rows] = await pool.execute(q, [phone]);
    res.json(rows);
  } catch (err) {
    console.error("GET PATIENT APPTS ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});

//get appointments for dr , loaded by id
app.get('/api/appointments/doctor/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const q = `SELECT a.appointment_id, a.date, a.status, a.patientName, a.phone, a.notes, a.patient_id, a.doctor_id FROM appointments a JOIN patients p ON p.patient_id = a.patient_id WHERE a.doctor_id = ? AND p.is_active = 1 ORDER BY a.date DESC`;
    const [rows] = await pool.execute(q, [id]);
    res.json(rows);
  } catch (err) {
    console.error("GET DOC APPTS ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});

app.get('/api/admin/appointments', async (req, res) => {
  try {
    const q = `
      SELECT 
        a.appointment_id,
        a.date,
        a.patientName,
        a.phone AS patientPhone,
        d.name AS doctorName,
        d.specialization,
        a.status,
        b.bill_id,
        b.total_amount,
        b.payment_status
      FROM appointments a
      JOIN doctors d ON d.doctor_id = a.doctor_id
      JOIN patients p ON p.patient_id = a.patient_id
      LEFT JOIN bills b ON b.appointment_id = a.appointment_id
      WHERE d.isActive = 1 AND p.is_active = 1
      ORDER BY a.date DESC
    `;
    const [rows] = await pool.execute(q);
    res.json(rows);
  } catch (err) {
    console.error("GET ADMIN APPTS ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});

app.put('/api/appointments/:id/status', async (req, res) => {
  const id = req.params.id;
  const { status } = req.body;
  if (!['Approved', 'Cancelled', 'Completed'].includes(status)) return res.status(400).json({ message: "Invalid status" });
  try {
    const q = `UPDATE appointments SET status = ? WHERE appointment_id = ?`;
    const [r] = await pool.execute(q, [status, id]);
    if (r.affectedRows === 0) return res.status(404).json({ message: "Appointment not found" });
    res.json({ message: `Appointment ${id} updated to ${status}` });
  } catch (err) {
    console.error("UPDATE APPT STATUS ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});


// Encounter, Prescription & Lab Orders

app.post('/api/laborders/submit', async (req, res) => {
  const {
    appointmentId,
    patient_id,
    doctor_id,
    tests = [],
    patientName,
    diagnosis,
    prescriptionText
  } = req.body;

  const finalDiagnosis = diagnosis || prescriptionText;
  if (!appointmentId || !patient_id || !doctor_id || !patientName || !finalDiagnosis) {
    return res.status(400).json({ message: "Missing required details" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const presQ = `INSERT INTO prescriptions (doctor_id, patient_id, prescription_text, appointment_id) VALUES (?, ?, ?, ?)`;
    const [presR] = await connection.execute(presQ, [doctor_id, patient_id, finalDiagnosis, appointmentId]);
    const prescription_id = presR.insertId;

    const consultation_service = 'Doctor Consultation';
    const [feeRows] = await connection.execute(`SELECT fee FROM services_fees WHERE service_name = ?`, [consultation_service]);
    let consultation_fee = 0;
    if (feeRows.length > 0) consultation_fee = parseFloat(feeRows[0].fee || 0);

    let total_amount = consultation_fee;
    if (tests && Array.isArray(tests) && tests.length > 0) {
      const testNames = tests.map(t => t.test_name);
      const [labFeeRows] = await connection.query(`SELECT service_name, fee FROM services_fees WHERE service_name IN (?)`, [testNames]);
      const labOrdersValues = [];

      for (const t of tests) {
        const feeRow = labFeeRows.find(r => r.service_name === t.test_name);
        const fee = feeRow ? parseFloat(feeRow.fee) : 0;
        total_amount += fee;

        const docLinkProvided = t.document_link ? t.document_link.toString().trim() : null;
        const normalizedDoc = docLinkProvided ? ensureReportPath(docLinkProvided) : null;

        labOrdersValues.push([patient_id, doctor_id, t.test_name, 'Ordered', fee, patientName, prescription_id, normalizedDoc]);
      }

      if (labOrdersValues.length > 0) {
        const insertQ = `INSERT INTO lab_orders (patient_id, doctor_id, test_name, status, fee, patientName, prescription_id, document_link) VALUES ?`;
        await connection.query(insertQ, [labOrdersValues]);
      }
    }

    const billQ = `
      INSERT INTO bills
        (appointment_id, patient_id, doctor_id, consultation_fee, total_amount, issue_date, payment_status, status)
      VALUES (?, ?, ?, ?, ?, NOW(), 'Pending', 'Pending')
    `;
    await connection.execute(billQ, [appointmentId, patient_id, doctor_id, consultation_fee, total_amount]);

    await connection.execute(`UPDATE appointments SET status = 'Completed' WHERE appointment_id = ?`, [appointmentId]);

    await connection.commit();
    res.json({ message: "Encounter completed", prescriptionId: prescription_id, total_bill: total_amount });
  } catch (err) {
    await connection.rollback();
    console.error("ENCOUNTER ERROR:", err);
    res.status(500).json({ message: "Database error completing encounter", error: err.code || err.message });
  } finally {
    connection.release();
  }
});


//prescription for the patient dyanmically aye gi dr se req.parms k through

app.get('/api/patients/:patientId/prescriptions', async (req, res) => {
  const patientId = req.params.patientId;
  try {
    const prescriptionsQ = `
      SELECT p.prescription_id, p.appointment_id, p.prescription_text AS diagnosis, p.created_at AS record_date, d.name AS doctorName
      FROM prescriptions p JOIN doctors d ON d.doctor_id = p.doctor_id
      WHERE p.patient_id = ? AND d.isActive = 1 ORDER BY p.created_at DESC
    `;
    const labOrdersQ = `
      SELECT lo.*, d.name AS doctorName
      FROM lab_orders lo JOIN doctors d ON d.doctor_id = lo.doctor_id
      WHERE lo.patient_id = ? AND d.isActive = 1 ORDER BY lo.order_date DESC
    `;
    const [presRows] = await pool.execute(prescriptionsQ, [patientId]);
    let [labRows] = await pool.execute(labOrdersQ, [patientId]);

    labRows = labRows.map(normalizeDocumentLink);

    const ordersByPrescription = labRows.reduce((acc, o) => {
      if (!acc[o.prescription_id]) acc[o.prescription_id] = [];
      acc[o.prescription_id].push(o);
      return acc;
    }, {});

    const combined = presRows.map(p => ({
      ...p,
      prescription_details: p.diagnosis,
      lab_orders: ordersByPrescription[p.prescription_id] || []
    }));

    res.json({ combinedHistory: combined, labReports: labRows });
  } catch (err) {
    console.error("GET PATIENT PRESCRIPTIONS ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});


// Patient bills

app.get('/api/patients/:patientId/bills', async (req, res) => {
  const patientId = req.params.patientId;
  try {
    const q = `
      SELECT 
        b.bill_id, b.issue_date, b.total_amount, b.payment_status,
        b.payment_date, b.consultation_fee,
        d.name AS doctorName,
        a.date AS appointment_date
      FROM bills b
      JOIN doctors d ON d.doctor_id = b.doctor_id
      JOIN appointments a ON a.appointment_id = b.appointment_id
      WHERE b.patient_id = ? AND d.isActive = 1
      ORDER BY b.issue_date DESC
    `;
    const [rows] = await pool.execute(q, [patientId]);
    res.json(rows);
  } catch (err) {
    console.error("GET PATIENT BILLS ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});


app.put('/api/bills/:billId/pay', async (req, res) => {
  const billId = req.params.billId;
  try {
    const q = `
      UPDATE bills
      SET payment_status = 'Paid',
          payment_date = NOW(),
          status = 'Paid'
      WHERE bill_id = ? AND payment_status = 'Pending'
    `;
    const [r] = await pool.execute(q, [billId]);
    if (r.affectedRows === 0) return res.status(404).json({ message: "Bill not found or already paid" });
    res.json({ message: `Bill ${billId} marked as Paid.` });
  } catch (err) {
    console.error("PAY BILL ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});


// Admin API

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) return res.json({ message: "Admin login successful" });
  res.status(401).json({ message: "Invalid Admin Credentials" });
});

app.get('/api/admin/stats', async (req, res) => {
  try {
    const [doctorCount] = await pool.execute(`SELECT COUNT(doctor_id) AS totalDoctors FROM doctors WHERE isActive = 1`);
    const [patientCount] = await pool.execute(`SELECT COUNT(patient_id) AS totalPatients FROM patients WHERE is_active = 1`);
    const [pendingApptCount] = await pool.execute(`SELECT COUNT(appointment_id) AS pendingAppointments FROM appointments WHERE status = 'Pending'`);
    const [deptCount] = await pool.execute(`SELECT COUNT(department_id) AS totalDepartments FROM departments`);

    res.json({
      totalDoctors: doctorCount[0].totalDoctors,    //dr count aik array hai jis ka pehla member count(dr) hai so is lie [0] ko access kia
      totalPatients: patientCount[0].totalPatients,
      pendingAppointments: pendingApptCount[0].pendingAppointments,
      totalDepartments: deptCount[0].totalDepartments
    });
  } catch (err) {
    console.error("GET ADMIN STATS ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});


app.get('/api/admin/patients', async (req, res) => {
  try {
    const [rows] = await pool.execute(`SELECT patient_id, name, gender, age, phone, address FROM patients WHERE is_active = 1`);
    //hr query k against array return hoti hai like attribute - value to hm ne is ko set kr dia const[rows] yani k tm ne bs jitni values hain row me vo return krna hai field nhi chahyen

    res.json(rows);
    //rows ko json me convert kr dia hai take http ko bheja ja ske

  } catch (err) {
    console.error("GET ADMIN PATIENTS ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});

app.get('/api/admin/patients/:patientId', async (req, res) => {
  const patientId = req.params.patientId;
  try {
    const q = `SELECT patient_id, name, age, gender, phone, address FROM patients WHERE patient_id = ? AND is_active = 1`;
    const [rows] = await pool.execute(q, [patientId]);
    if (!rows.length) return res.status(404).json({ message: "Patient not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("GET ADMIN PATIENT ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});

app.get('/api/admin/patients/:patientId/appointments', async (req, res) => {
  const patientId = req.params.patientId;     //req.parms dyamically is url pe jaye ga or data le k aye ga mtlb api ka url uthaye ga or age / kr k id likh de ga
  try {
    const q = `
      SELECT a.appointment_id, a.date, a.status, d.name AS doctorName, d.specialization
      FROM appointments a JOIN doctors d ON d.doctor_id = a.doctor_id
      WHERE a.patient_id = ? AND d.isActive = 1 ORDER BY a.date DESC
    `;
    const [rows] = await pool.execute(q, [patientId]);
    res.json(rows);
  } catch (err) {
    console.error("GET ADMIN PATIENT APPTS ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});

app.get('/api/admin/patients/:patientId/clinicalhistory', async (req, res) => {
  const patientId = req.params.patientId;

  try {
    const presQ = `
      SELECT 
        p.prescription_id,
        p.appointment_id,
        p.prescription_text AS diagnosis,
        p.created_at AS record_date,
        d.name AS doctorName
      FROM prescriptions p
      JOIN doctors d ON d.doctor_id = p.doctor_id
      WHERE p.patient_id = ? AND d.isActive = 1
      ORDER BY p.created_at DESC
    `;

    const labQ = `
      SELECT 
        lo.order_id,
        lo.test_name,
        lo.status,
        lo.document_link,
        lo.fee,
        lo.prescription_id,
        lo.report_date,
        lo.order_date,
        lo.patientName,
        d.name AS doctorName
      FROM lab_orders lo
      JOIN doctors d ON d.doctor_id = lo.doctor_id
      WHERE lo.patient_id = ? AND d.isActive = 1
      ORDER BY lo.order_date DESC
    `;

    const [presRows] = await pool.execute(presQ, [patientId]);
    let [labRows] = await pool.execute(labQ, [patientId]);

    //ye reports k link ko theek krne k lie bnaya tha like the normalise one 

    labRows = labRows.map(row => {
      if (row.document_link && !row.document_link.startsWith("/reports/")) {
        row.document_link = "/reports/" + row.document_link.replace(/^\/+/, "");
      }
      return row;     //map aik new array return krta hai hm ne link theek kr k row return krwa di 
    });

    const history = presRows.map(p => ({
      ...p,       //ye copy ka shortcut hai hm sari prescription copy kr rhe hain or sath me laborders ko aik new field k tor pr add kr rhe hain or aik object bna dia hm ne history ka
      lab_orders: labRows.filter(l => l.prescription_id === p.prescription_id)
    }));

    res.json(history);

  } catch (err) {
    console.error("GET ADMIN CLINICAL HISTORY ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});

//Deleting a patient 
app.delete('/api/admin/patients/:id', async (req, res) => {
  const patientId = req.params.id;
  try {
    const [result] = await pool.query('UPDATE patients SET is_active = 0 WHERE patient_id = ?', [patientId]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Patient not found' });
    res.json({ message: 'Patient deactivated successfully' });
  } catch (err) {
    console.error('DELETE PATIENT ERROR:', err);
    res.status(500).json({ message: 'Failed to deactivate patient' });
  }
});


// Lab Orders

app.get('/api/admin/laborders', async (req, res) => {
  try {
    const q = `
      SELECT lo.*, d.name AS doctorName
      FROM lab_orders lo 
      JOIN doctors d ON d.doctor_id = lo.doctor_id
      JOIN patients p ON p.patient_id = lo.patient_id
      WHERE d.isActive = 1 AND p.is_active = 1
      ORDER BY lo.order_date DESC
    `;
    let [rows] = await pool.execute(q);     //let is lie kyon k hm baad me is k url ko cahneg krte hain neeche
    rows = rows.map(normalizeDocumentLink);
    res.json(rows);
  } catch (err) {
    console.error("GET ADMIN LABORDERS ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});

app.get('/api/laborders', async (req, res) => {
  try {
    const q = `
      SELECT lo.*, d.name AS doctorName
      FROM lab_orders lo 
      JOIN doctors d ON d.doctor_id = lo.doctor_id
      JOIN patients p ON p.patient_id = lo.patient_id
      WHERE lo.status = 'Ordered' AND d.isActive = 1 AND p.is_active = 1
      ORDER BY lo.order_date ASC
    `;
    const [rows] = await pool.execute(q);
    res.json(rows);
  } catch (err) {
    console.error("GET PENDING LABORDERS ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});

app.put("/api/admin/laborders/:id/complete", async (req, res) => {
  const orderId = req.params.id;
  const docPath = "/reports/sara_cbc_report.ejs";

  const sql = `
    UPDATE lab_orders
    SET status = 'Completed',
        document_link = ?,
        report_date = NOW()
    WHERE order_id = ?
  `;

  try {
    const [result] = await pool.execute(sql, [docPath, orderId]);
    if (!result.affectedRows) return res.status(404).json({ message: "Order not found" });
    res.json({ message: "Lab order completed", document_link: docPath });
  } catch (err) {
    console.error("COMPLETE LAB ORDER ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});


// Bills

app.get('/api/admin/bills', async (req, res) => {
  try {
    const q = `
      SELECT b.*, p.name AS patientName, d.name AS doctorName, a.date AS appointment_date
      FROM bills b
      JOIN patients p ON p.patient_id = b.patient_id
      JOIN doctors d ON d.doctor_id = b.doctor_id
      JOIN appointments a ON a.appointment_id = b.appointment_id
      WHERE p.is_active = 1 AND d.isActive = 1
      ORDER BY b.issue_date DESC
    `;
    const [rows] = await pool.execute(q);
    res.json(rows);
  } catch (err) {
    console.error("GET BILLS ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});

app.get('/api/bills/:id', async (req, res) => {     //bill k table me se direct uthaon gi
  const billId = req.params.id;     //api k url pr is id se utha kr lao
  try {
    const q = `
      SELECT b.*, 
             p.name AS patientName,
             d.name AS doctorName,
             a.date AS appointment_date
      FROM bills b
      JOIN patients p ON p.patient_id = b.patient_id
      JOIN doctors d ON d.doctor_id = b.doctor_id
      JOIN appointments a ON a.appointment_id = b.appointment_id
      WHERE b.bill_id = ? AND p.is_active = 1 AND d.isActive = 1
    `;
    const [rows] = await pool.execute(q, [billId]);
    if (!rows.length)     //sql k table me kuch pra hi nhi hoa
       return res.status(404).json({ message: "Bill not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("GET BILL ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});

app.put('/api/admin/bills/:billId/status', async (req, res) => {
  const billId = req.params.billId;
  const { status } = req.body;
  const allowed = ['Paid', 'Unpaid', 'Canceled', 'Pending'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ message: "Invalid status. Allowed: " + allowed.join(', ') });
  }
  try {
    const q = `
      UPDATE bills
      SET 
        payment_status = ?,
        status = ?,
        payment_date = CASE WHEN ? = 'Paid' THEN NOW() ELSE NULL END
      WHERE bill_id = ?
    `;
    const [r] = await pool.execute(q, [status, status, status, billId]);
    if (r.affectedRows === 0) return res.status(404).json({ message: "Bill not found" });
    res.json({ message: `Bill ${billId} updated to ${status}` });
  } catch (err) {
    console.error("UPDATE BILL STATUS ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});


// Services 


app.get('/api/services', async (req, res) => {
  try {
    const [rows] = await pool.execute(`SELECT service_id, service_name, fee, service_type FROM services_fees ORDER BY service_type, service_name`);
    res.json(rows);
  } catch (err) {
    console.error("GET SERVICES ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});

app.get('/api/departments', async (req, res) => {
  try {
    const [rows] = await pool.execute(`SELECT department_id, name FROM departments ORDER BY name`);
    res.json(rows);
  } catch (err) {
    console.error("GET DEPTS ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});

app.post('/api/departments', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: "Department name is required" });
  try {
    const q = "INSERT INTO departments (name) VALUES (?)";
    const [result] = await pool.execute(q, [name]);
    res.json({ message: "Department added successfully", id: result.insertId });    //backend ki id 
  } catch (err) {
    console.error("ADD DEPT ERROR:", err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: "Department already exists" });
    }
    res.status(500).json({ message: "Error adding department", error: err.message });
  }
});

app.delete('/api/departments/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const q = `DELETE FROM departments WHERE department_id = ?`;
    const [r] = await pool.execute(q, [id]);
    if (r.affectedRows === 0) return res.status(404).json({ message: "Department not found" });
    res.json({ message: "Department deleted successfully" });
  } catch (err) {
    console.error("DELETE DEPARTMENT ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});


// Reports rendering

app.get('/reports/:fileName', async (req, res) => {
  const orderId = req.query.order_id;     //order id pe ja k file l k ao dynamic
  if (!orderId)             
      return res.status(400).send("Missing order_id");

  try {
    const query = `
      SELECT 
        lo.order_id, lo.test_name, lo.order_date, lo.report_date,
        p.patient_id, p.name AS patientName, p.age,
        d.doctor_id, d.name AS doctorName
      FROM lab_orders lo
      JOIN patients p ON p.patient_id = lo.patient_id
      JOIN doctors d ON d.doctor_id = lo.doctor_id
      WHERE lo.order_id = ? AND p.is_active = 1 AND d.isActive = 1
      LIMIT 1
    `;

    const [rows] = await pool.execute(query, [orderId]);
    if (!rows.length) return res.status(404).send("Report not found");

    const reportData = rows[0];
    const gen = generateResultsForTest(reportData.test_name);

    res.render("sara_cbc_report", {
      report: reportData,
      testName: reportData.test_name,
      displayTestName: gen ? gen.displayName : reportData.test_name,
      generatedResults: gen ? gen.fields : null,
      dateCollected: reportData.order_date ? new Date(reportData.order_date).toLocaleDateString() : "N/A",
      dateReported: reportData.report_date ? new Date(reportData.report_date).toLocaleDateString() : "N/A",
      patientAge: reportData.age || "N/A"
    });

  } catch (err) {
    console.error("Report render error:", err);
    res.status(500).send("Server error");
  }
});

//get all lab orders
app.get('/api/laborders/all', async (req, res) => {
  try {
    const q = `
      SELECT lo.order_id, lo.test_name, lo.order_date, lo.status, lo.document_link,
             p.name AS patientName, p.patient_id, d.name AS doctorName, d.doctor_id
      FROM lab_orders lo
      LEFT JOIN prescriptions pr ON lo.prescription_id = pr.prescription_id
      LEFT JOIN patients p ON pr.patient_id = p.patient_id
      LEFT JOIN doctors d ON lo.doctor_id = d.doctor_id
      WHERE p.is_active = 1 AND d.isActive = 1
      ORDER BY lo.order_date DESC, lo.status
    `;
    let [rows] = await pool.execute(q);
    rows = rows.map(normalizeDocumentLink);
    res.json(rows);
  } catch (err) {
    console.error("GET LABORDERS ALL ERROR:", err);
    res.status(500).json({ message: "Error", error: err.code || err.message });
  }
});

//delete an existing appointment
app.delete('/appointments/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const q = "DELETE FROM appointments WHERE appointment_id = ?";
    const [result] = await pool.execute(q, [id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: "Appointment not found" });
    res.json({ message: "Appointment deleted successfully" });
  } catch (err) {
    console.error("DELETE APPOINTMENT ERROR:", err);
    res.status(500).json({ error: "Delete failed", details: err.message });
  }
});

app.post("/forgot-password", async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).send("Phone is required");

  try {
    // Check if phone exists
    const [rows] = await pool.execute(
      "SELECT patient_id FROM patients WHERE phone = ? AND is_active = 1",
      [phone]
    );

    if (rows.length === 0) return res.status(404).send("Phone number not registered");

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000);
    const expiry = new Date(Date.now() + 10 * 60 * 1000);

    // Save OTP in DB
    await pool.execute(
      "UPDATE patients SET otp = ?, otp_expiry = ? WHERE phone = ?",
      [otp, expiry, phone]
    );

    // Convert phone to international format for MSG91
let phoneWithCountry = phone;
if (phone.startsWith("0")) {
    phoneWithCountry = "92" + phone.slice(1); // remove leading 0, add country code
}

    // Send OTP via MSG91
    const msg91URL = `https://api.msg91.com/api/sendhttp.php?authkey=${apiKey}&mobiles=${phone}&message=Your%20OTP%20is%20${otp}&sender=MSGIND&route=4&country=92`;
    
    const response = await fetch(msg91URL);
    const resultText = await response.text();

    if (!response.ok) {
        console.error("MSG91 ERROR:", resultText);
        return res.status(500).send("Failed to send OTP");
    }

    res.send("OTP sent successfully");

  } catch (err) {
    console.error("FORGOT PASSWORD ERROR:", err);
    res.status(500).send("Error sending OTP");
  }
});

// Update Patient Profile
app.put('/api/patients/:id', async (req, res) => {
    const { id } = req.params;
    const { name, phone, password } = req.body;

    try {
        let query;
        let params;

        if (password) {
            // Update name, phone, and password
            query = "UPDATE patients SET name = ?, phone = ?, password = ? WHERE patient_id = ?";
            params = [name, phone, password, id];
        } else {
            // Update only name and phone
            query = "UPDATE patients SET name = ?, phone = ? WHERE patient_id = ?";
            params = [name, phone, id];
        }

        const [result] = await pool.execute(query, params);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Patient not found" });
        }

        res.json({ message: "Profile updated successfully" });
    } catch (err) {
        console.error("UPDATE PROFILE ERROR:", err);
        // Check for duplicate phone number error
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: "Phone number already in use" });
        }
        res.status(500).json({ message: "Server error", error: err.message });
    }
});


app.listen(port, () => {        //listen computer ko btaye ga humare server ko is port pr chalao
  console.log(`Server running at http://localhost:${port}`);            
});



//nodemon ko donwnload kron gi to server.js k bilkul vese hi chale ge saved changes jese noetpad me html ko savr kr k refresh kro 
//nodemon install kr k script me server nodemeon sever js bhi likhna hai or phir termianl pe run ki command chalani ho gi
//will do this baad me inshallah



//reports rendering dekhni hai 
//put apis 