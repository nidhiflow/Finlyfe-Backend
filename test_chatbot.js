async function test() {
  const payload = { email: 'demo@finly.app', password: 'demo123' };

  console.log("1. Logging in locally...");
  const loginRes = await fetch('http://localhost:3002/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const loginData = await loginRes.json();
  const token = loginData.token;
  if (!token) {
    console.error("Login failed:", loginData);
    return;
  }

  console.log("2. Sending chat message to Finly Chatbot...");
  const chatRes = await fetch('http://localhost:3002/api/ai/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ message: "Can u look at my transactions and guide me how to save more money" })
  });

  const chatData = await chatRes.json();
  console.log("\nChatbot Response:");
  console.log(chatData.reply);
}

test();
