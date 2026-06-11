const supabaseUrl = "https://nizhtuzqmtlgfqmxpybb.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pemh0dXpxbXRsZ2ZxbXhweWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTU1OTIsImV4cCI6MjA4OTY3MTU5Mn0.L8zZrPWZM9Gas7fd8047MV1ob_1Cti7W2zLOoiQ8o4Y";

async function main() {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'GET',
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`
      }
    });
    if (!res.ok) {
      console.error("Failed to fetch API spec:", res.statusText);
      const text = await res.text();
      console.error(text);
      return;
    }
    const data = await res.json();
    console.log("Tables found:", Object.keys(data.definitions || {}));
    
    // Output definition details for requests, shifts, and staff
    const targets = ['requests', 'shifts', 'staff'];
    for (const t of targets) {
      console.log(`\n=== Properties for: ${t} ===`);
      if (data.definitions && data.definitions[t]) {
        console.log(JSON.stringify(data.definitions[t].properties, null, 2));
      } else {
        console.log("Definition not found");
      }
    }
  } catch (err) {
    console.error(err);
  }
}

main();
