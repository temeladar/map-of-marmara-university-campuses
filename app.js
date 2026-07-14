const map = L.map("map");

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> katkıcıları'
}).addTo(map);

const listEl = document.getElementById("campus-list");
const markers = [];

CAMPUSES.forEach((campus, i) => {
  const marker = L.marker([campus.lat, campus.lng])
    .addTo(map)
    .bindPopup(
      `<strong>${campus.name}</strong><br>` +
      `<em>${campus.district}</em><br>` +
      `${campus.info}`
    );
  markers.push(marker);

  const li = document.createElement("li");
  li.innerHTML = `<span class="campus-name">${campus.name}</span>` +
                 `<span class="campus-district">${campus.district}</span>`;
  li.addEventListener("click", () => {
    map.flyTo([campus.lat, campus.lng], 15);
    marker.openPopup();
    listEl.querySelectorAll("li").forEach(el => el.classList.remove("active"));
    li.classList.add("active");
  });
  listEl.appendChild(li);
});

map.fitBounds(L.featureGroup(markers).getBounds().pad(0.1));
