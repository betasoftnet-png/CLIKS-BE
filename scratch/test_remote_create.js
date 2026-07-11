const token = 'developer-token';

async function run() {
  try {
    const postRes = await fetch('https://cliks.beta-softnet.com/api/v1/people/1/reminders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        title: 'Test 9000 Dev Token',
        amount: '9000',
        due_date: '2026-07-20'
      })
    });
    console.log('POST status:', postRes.status);
    console.log('POST body:', await postRes.json());
  } catch (err) {
    console.error(err);
  }
}

run();
