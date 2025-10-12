import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Lobby from "./pages/Lobby.jsx";
import Room from "./pages/Room.jsx";
import Quiz from "./pages/Quiz.jsx";
import "./index.css"; // Tailwind Imports

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Startseite → zeigt Lobby */}
        <Route path="/" element={<Lobby />} />

        {/* Raumseite mit Code → zeigt Room */}
        <Route path="/room/:code" element={<Room />} />

        {/* Spiel starten */}
        <Route path="/quiz" element={<Quiz />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
