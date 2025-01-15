import { useEffect, useState } from 'react';
import './App.css';
import { initializeAvatarSession, terminateAvatarSession } from './main';

function App() {
  const [isSessionActive, setIsSessionActive] = useState(false);

  useEffect(() => {
    const startButton = document.getElementById("startSession");
    const endButton = document.getElementById("endSession");
    const statusText = document.querySelector(".status-text");

    if (startButton && endButton && statusText) {
      startButton.addEventListener("click", async () => {
        try {
          await initializeAvatarSession();
          setIsSessionActive(true);
        } catch (error) {
          console.error('Failed to start session:', error);
        }
      });

      endButton.addEventListener("click", async () => {
        try {
          await terminateAvatarSession();
          setIsSessionActive(false);
        } catch (error) {
          console.error('Failed to end session:', error);
        }
      });
    }

    return () => {
      // Cleanup event listeners
      startButton?.removeEventListener("click", initializeAvatarSession);
      endButton?.removeEventListener("click", terminateAvatarSession);
    };
  }, []);

  return null; // UI is handled by index.html
}

export default App; 