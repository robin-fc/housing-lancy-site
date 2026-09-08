import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChevronDown,
  CircleAlert,
  Crosshair,
  ExternalLink,
  GraduationCap,
  HandCoins,
  Home,
  House,
  Info,
  Layers3,
  LocateFixed,
  MapPin,
  RefreshCcw,
  Ruler,
  ShieldCheck,
  TrainFront,
  X,
} from 'lucide-react';
import { metroLines } from './data/metro';
import { homePresets, jobCategories, jobRecords, officePoints } from './data/jobs';
import { properties, propertyDataUpdatedAt } from './data/properties';
import { rings } from './data/rings.json';
import { createBasemap } from './outer-ring-tiles';
import './styles.css';

const SHANGHAI_CENTER = [31.2286, 121.4747];

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function buildTransitGraph(lines) {
  const nodes = new Map();
  const edges = new Map();
  const stationsByName = new Map();

  const addEdge = (from, to, minutes, kind) => {
    if (!edges.has(from)) edges.set(from, []);
    edges.get(from).push({ to, minutes, kind });
  };

  lines.forEach((line, lineIndex) => {
    line.stations.forEach((station, stationIndex) => {
      const id = `${lineIndex}:${stationIndex}`;
      nodes.set(id, { ...station, id, line: line.name, color: line.color });
      if (!stationsByName.has(station.name)) stationsByName.set(station.name, []);
      stationsByName.get(station.name).push(id);
      if (stationIndex > 0) {
        const previousId = `${lineIndex}:${stationIndex - 1}`;
        const previous = line.stations[stationIndex - 1];
        const rideMinutes = Math.max(1.6, (distanceKm(previous, station) / 34) * 60 + 0.6);
        addEdge(id, previousId, rideMinutes, 'ride');
        addEdge(previousId, id, rideMinutes, 'ride');
      }
    });
  });

  stationsByName.forEach((ids) => {
    ids.forEach((from) => ids.forEach((to) => {
      if (from !== to) addEdge(from, to, 5, 'transfer');
    }));
  });

  return { nodes, edges };
}

const transitGraph = buildTransitGraph(metroLines);

function nearestStation(point) {
  let nearest = null;
  transitGraph.nodes.forEach((station) => {
    const distance = distanceKm(point, station);
    if (!nearest || distance < nearest.distance) nearest = { station, distance };
  });
  return nearest;
}

function estimateCommute(from, to) {
  const origin = nearestStation(from);
  const destination = nearestStation(to);
  const distances = new Map([[origin.station.id, 0]]);
  const transfers = new Map([[origin.station.id, 0]]);
  const queue = [{ id: origin.station.id, minutes: 0 }];

  while (queue.length) {
    queue.sort((a, b) => a.minutes - b.minutes);
    const current = queue.shift();
    if (current.minutes !== distances.get(current.id)) continue;
    if (current.id === destination.station.id) break;
    (transitGraph.edges.get(current.id) || []).forEach((edge) => {
      const next = current.minutes + edge.minutes;
      if (next < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, next);
        transfers.set(edge.to, transfers.get(current.id) + (edge.kind === 'transfer' ? 1 : 0));
        queue.push({ id: edge.to, minutes: next });
      }
    });
  }

  const walking = ((origin.distance + destination.distance) / 4.6) * 60;
  return {
    minutes: Math.round(walking + (distances.get(destination.station.id) ?? 0) + 3),
    transfers: transfers.get(destination.station.id) ?? 0,
    originStation: origin.station.name,
    destinationStation: destination.station.name,
    originWalk: Math.round(origin.distance * 1000),
  };
}

function companyIcon(company, selected) {
  const color = jobCategories[company.category].color;
  return L.divIcon({
    className: 'company-marker-wrap',
    html: `<div class="company-marker ${selected ? 'is-selected' : ''}" style="--marker-color:${color}"><span>${company.shortName}</span><b>${company.jobs.length}</b></div>`,
    iconSize: [82, 34],
    iconAnchor: [41, 17],
  });
}

function propertyIcon(property, selected) {
  return L.divIcon({
    className: 'property-marker-wrap',
    html: `<div class="property-marker ${selected ? 'is-selected' : ''}"><span>${property.totalPrice}万</span></div>`,
    iconSize: [62, 34],
    iconAnchor: [31, 17],
  });
}

const homeIcon = L.divIcon({
  className: 'home-marker-wrap',
  html: '<div class="home-marker"><span>住</span></div>',
  iconSize: [38, 38],
  iconAnchor: [19, 19],
});

function MapCanvas({ visibleCompanies, showBasemap, showMetro, showStations, showCompanies, showProperties, visibleRings, selectedCompany, selectedProperty, onSelectCompany, onSelectProperty, homePoint, onSetHome, pickingHome }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({ basemap: null, metro: null, stations: null, jobs: null, properties: null, home: null });
  const ringsRef = useRef({});

  useEffect(() => {
    const map = L.map(containerRef.current, {
      zoomControl: false, preferCanvas: true, scrollWheelZoom: true,
      minZoom: 10, maxZoom: 18,
    }).setView(SHANGHAI_CENTER, 11);
    rings.forEach((ring, index) => {
      const pane = `ring-${ring.id}`;
      map.createPane(pane);
      map.getPane(pane).style.zIndex = 310 + index;
      map.getPane(pane).style.pointerEvents = 'none';
      ringsRef.current[ring.id] = L.polygon(ring.positions, {
        pane, color: ring.color, weight: 2, opacity: 0.85,
        fillColor: ring.color, fillOpacity: 0.12, interactive: false,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      });
    });
    map.createPane('metro-lines');
    map.getPane('metro-lines').style.zIndex = 350;
    map.createPane('job-points');
    map.getPane('job-points').style.zIndex = 650;
    map.createPane('property-points');
    map.getPane('property-points').style.zIndex = 625;
    layersRef.current.basemap = createBasemap().addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    layersRef.current.metro = L.layerGroup().addTo(map);
    layersRef.current.stations = L.layerGroup().addTo(map);
    layersRef.current.jobs = L.layerGroup().addTo(map);
    layersRef.current.properties = L.layerGroup().addTo(map);
    layersRef.current.home = L.layerGroup().addTo(map);
    mapRef.current = map;
    const onResize = () => map.invalidateSize();
    window.addEventListener('resize', onResize);
    setTimeout(onResize, 80);
    return () => {
      window.removeEventListener('resize', onResize);
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const basemap = layersRef.current.basemap;
    if (!map || !basemap) return;
    if (showBasemap && !map.hasLayer(basemap)) basemap.addTo(map);
    if (!showBasemap && map.hasLayer(basemap)) map.removeLayer(basemap);
  }, [showBasemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    rings.forEach(({ id }) => {
      const layer = ringsRef.current[id];
      if (visibleRings[id]) layer.addTo(map);
      else map.removeLayer(layer);
    });
  }, [visibleRings]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const handler = (event) => {
      if (pickingHome) onSetHome({ lat: event.latlng.lat, lng: event.latlng.lng, name: '自选位置' });
    };
    map.on('click', handler);
    map.getContainer().classList.toggle('is-picking', pickingHome);
    return () => map.off('click', handler);
  }, [pickingHome, onSetHome]);

  useEffect(() => {
    const { metro, stations } = layersRef.current;
    if (!metro || !stations) return;
    metro.clearLayers();
    stations.clearLayers();
    if (showMetro) {
      metroLines.forEach((line) => {
        L.polyline(line.stations.map((station) => [station.lat, station.lng]), {
          pane: 'metro-lines', color: '#ffffff', opacity: 0.9, weight: 6,
        }).addTo(metro);
        L.polyline(line.stations.map((station) => [station.lat, station.lng]), {
          pane: 'metro-lines', color: line.color, opacity: 0.82, weight: 3,
        }).bindTooltip(line.name, { sticky: true }).addTo(metro);
      });
    }
    if (showStations) {
      const unique = new Map();
      metroLines.flatMap((line) => line.stations).forEach((station) => unique.set(station.name, station));
      unique.forEach((station) => L.circleMarker([station.lat, station.lng], {
        pane: 'metro-lines', radius: 2.2, color: '#50554f', weight: 1, fillColor: '#ffffff', fillOpacity: 1,
      }).bindTooltip(station.name, {
        permanent: true, direction: 'right', offset: [5, 0], opacity: 1, className: 'station-label',
      }).addTo(stations));
    }
  }, [showMetro, showStations]);

  useEffect(() => {
    const jobsLayer = layersRef.current.jobs;
    if (!jobsLayer) return;
    jobsLayer.clearLayers();
    if (!showCompanies) return;
    visibleCompanies.forEach((company) => {
      L.marker([company.lat, company.lng], {
        pane: 'job-points', icon: companyIcon(company, selectedCompany?.id === company.id),
      }).on('click', () => onSelectCompany(company)).addTo(jobsLayer);
    });
  }, [showCompanies, visibleCompanies, selectedCompany, onSelectCompany]);

  useEffect(() => {
    const propertyLayer = layersRef.current.properties;
    if (!propertyLayer) return;
    propertyLayer.clearLayers();
    if (!showProperties) return;
    properties.forEach((property) => {
      L.marker([property.lat, property.lng], {
        pane: 'property-points', icon: propertyIcon(property, selectedProperty?.id === property.id),
      }).bindTooltip(`${property.community} · ${property.totalPrice}万`, { direction: 'top' })
        .on('click', () => onSelectProperty(property)).addTo(propertyLayer);
    });
  }, [showProperties, selectedProperty, onSelectProperty]);

  useEffect(() => {
    const homeLayer = layersRef.current.home;
    if (!homeLayer) return;
    homeLayer.clearLayers();
    if (homePoint) L.marker([homePoint.lat, homePoint.lng], { pane: 'job-points', icon: homeIcon }).addTo(homeLayer);
  }, [homePoint]);

  return <div ref={containerRef} className="map-canvas" aria-label="上海岗位与地铁通勤地图" />;
}

function FilterToggle({ category, checked, onChange, count }) {
  const meta = jobCategories[category];
  return (
    <label className={`filter-toggle ${checked ? 'is-active' : ''}`} style={{ '--category-color': meta.color }}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(category, event.target.checked)} />
      <span className="filter-dot" />
      <span>{meta.label}</span>
      <b>{count}</b>
    </label>
  );
}

function CompanyDetail({ company, jobs, commute, onClose }) {
  const [selectedJobId, setSelectedJobId] = useState(jobs[0]?.id);

  useEffect(() => {
    setSelectedJobId(jobs[0]?.id);
  }, [company.id, jobs]);

  const job = jobs.find((item) => item.id === selectedJobId) || jobs[0];
  if (!job) return null;

  return (
    <section className="detail-panel" aria-live="polite">
      <button className="icon-button detail-close" onClick={onClose} aria-label="关闭公司详情"><X size={17} /></button>
      <div className="detail-kicker"><span style={{ background: jobCategories[job.category].color }} />{jobs.length} 个相关岗位</div>
      <h2>{company.name}</h2>
      <div className="detail-meta"><MapPin size={15} /><span>{company.area} · {company.locationLevel}</span></div>
      {commute && (
        <div className="commute-strip">
          <div><strong>{commute.minutes}</strong><span>分钟估算</span></div>
          <div><strong>{commute.transfers}</strong><span>次换乘</span></div>
          <p>{commute.originStation} → {commute.destinationStation}</p>
        </div>
      )}

      <div className="job-list" aria-label={`${company.name}岗位列表`}>
        {jobs.map((item) => (
          <button key={item.id} className={item.id === job.id ? 'is-active' : ''} onClick={() => setSelectedJobId(item.id)}>
            <span><b>{item.title}</b><small>{item.track} · {item.published}</small></span>
            <strong>{item.salary.text.split(' · ')[0]}</strong>
          </button>
        ))}
      </div>

      <article className="job-detail">
        <div className="job-track-row">
          <span style={{ '--tag-color': jobCategories[job.category].color }}>{job.track}</span>
          {job.salary.estimated && <em>平台估算</em>}
        </div>
        <h3>{job.title}</h3>
        <div className="job-facts">
          <span><HandCoins size={14} />{job.salary.text}</span>
          <span><CalendarDays size={14} />发布 {job.published}</span>
          <span><BriefcaseBusiness size={14} />{job.experience} · {job.employment}</span>
          <span><GraduationCap size={14} />{job.education} · {job.workSite}</span>
        </div>
        {job.salaryReason && <p className="salary-note">薪资说明：{job.salaryReason}</p>}
        <h4>岗位职责</h4>
        <p className="detail-note">{job.description}</p>
        <h4>岗位要求</h4>
        <ul className="requirements-list">
          {job.requirements.map((requirement, index) => <li key={`${job.id}-${index}`}>{requirement}</li>)}
        </ul>
        <div className="source-block">
          <span>{job.source.collectedBy}</span>
          <a className="source-link" href={job.source.url} target="_blank" rel="noreferrer">打开{job.source.label} <ExternalLink size={14} /></a>
        </div>
      </article>
    </section>
  );
}

function PropertyDetail({ property, onClose, onUseAsHome }) {
  const hasVerificationCode = Boolean(property.verificationCode);
  return (
    <section className="detail-panel property-detail-panel" aria-live="polite">
      <button className="icon-button detail-close" onClick={onClose} aria-label="关闭房源详情"><X size={17} /></button>
      <div className="detail-kicker property-kicker"><House size={13} />140 万以内房源样本</div>
      <h2>{property.community}</h2>
      <div className="property-price"><strong>{property.totalPrice} 万</strong><span>{property.unitPrice.toLocaleString('zh-CN')} 元/㎡</span></div>
      <div className="detail-meta"><MapPin size={15} /><span>{property.district} · {property.subarea} · {property.locationLevel}</span></div>

      <div className="property-facts">
        <span><House size={15} /><b>{property.rooms}</b></span>
        <span><Ruler size={15} /><b>{property.area}㎡</b></span>
        <span><Building2 size={15} /><b>{property.floor}</b></span>
        <span><Info size={15} /><b>{property.orientation}{property.year ? ` · ${property.year}年` : ''}</b></span>
      </div>

      <div className={`ownership-box ${hasVerificationCode ? 'has-code' : ''}`}>
        <div>{hasVerificationCode ? <BadgeCheck size={18} /> : <ShieldCheck size={18} />}<strong>{property.verificationLevel}</strong></div>
        <p>{property.ownershipClaim}</p>
        {hasVerificationCode && <code>房源核验编码 {property.verificationCode}</code>}
      </div>

      <dl className="property-legal">
        <div><dt>挂牌日期</dt><dd>{property.listingDate}</dd></div>
        <div><dt>产权性质</dt><dd>{property.propertyType}</dd></div>
        <div><dt>产权年限</dt><dd>{property.tenure}</dd></div>
        <div><dt>抵押状态</dt><dd>{property.mortgageInfo}</dd></div>
        <div><dt>产权所有</dt><dd>{property.propertyRights}</dd></div>
        <div><dt>房本备件</dt><dd>{property.sparePartsForRoom}</dd></div>
      </dl>

      <div className="property-tags">{property.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
      {property.warning && <p className="property-warning"><CircleAlert size={15} />{property.warning}</p>}
      <p className="due-diligence-note"><ShieldCheck size={15} />挂牌声明和平台核验编码不等于完成产权审查。签约前仍需本人调取不动产登记簿、核验抵押与限制登记，并核对共有权人。</p>

      <button className="use-home-button" onClick={() => onUseAsHome(property)}><TrainFront size={16} />用此房源试算通勤</button>
      <div className="source-block">
        <span>数据核对：{propertyDataUpdatedAt}</span>
        <a className="source-link" href={property.source} target="_blank" rel="noreferrer">打开{property.sourceLabel} <ExternalLink size={14} /></a>
      </div>
    </section>
  );
}

function HomeSummary({ point, results, onClear, onSelectCompany }) {
  return (
    <section className="home-summary" aria-live="polite">
      <div className="section-heading">
        <div><span className="eyebrow">候选居住点</span><h2>{point.name}</h2></div>
        <button className="icon-button" onClick={onClear} aria-label="清除候选居住点"><RefreshCcw size={16} /></button>
      </div>
      <p className="home-station"><TrainFront size={15} />步行约 {results[0]?.commute.originWalk ?? 0} 米到 {results[0]?.commute.originStation}</p>
      <div className="commute-list">
        {results.map(({ company, commute }) => (
          <button key={company.id} onClick={() => onSelectCompany(company)}>
            <span className="company-mini-dot" style={{ background: jobCategories[company.category].color }} />
            <span className="commute-company">{company.shortName} · {company.jobs.length}岗</span>
            <span className="commute-route">到 {commute.destinationStation}</span>
            <strong>{commute.minutes} 分</strong>
          </button>
        ))}
      </div>
      <p className="estimate-note"><Info size={13} />按步行 + 线网行驶 + 换乘惩罚估算，仅用于片区初筛。</p>
    </section>
  );
}

function App() {
  const [filters, setFilters] = useState({ ai: true, web3: true });
  const [showBasemap, setShowBasemap] = useState(true);
  const [showMetro, setShowMetro] = useState(true);
  const [showStations, setShowStations] = useState(false);
  const [showProperties, setShowProperties] = useState(true);
  const [showCompanies, setShowCompanies] = useState(true);
  const [visibleRings, setVisibleRings] = useState(() => Object.fromEntries(rings.map(({ id }) => [id, true])));
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [homePoint, setHomePoint] = useState(null);
  const [pickingHome, setPickingHome] = useState(false);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);

  const visibleCompanies = useMemo(() => officePoints
    .map((company) => ({
      ...company,
      jobs: jobRecords.filter((job) => job.officeId === company.id && filters[job.category]),
    }))
    .filter((company) => company.jobs.length > 0), [filters]);
  const commuteResults = useMemo(() => {
    if (!homePoint) return [];
    return visibleCompanies
      .map((company) => ({ company, commute: estimateCommute(homePoint, company) }))
      .sort((a, b) => a.commute.minutes - b.commute.minutes);
  }, [homePoint, visibleCompanies]);
  const selectedCommute = selectedCompany && homePoint
    ? commuteResults.find((item) => item.company.id === selectedCompany.id)?.commute
    : null;
  const selectedJobs = useMemo(() => selectedCompany
    ? jobRecords.filter((job) => job.officeId === selectedCompany.id && filters[job.category])
    : [], [selectedCompany, filters]);
  const counts = useMemo(() => ({
    ai: jobRecords.filter((job) => job.category === 'ai').length,
    web3: jobRecords.filter((job) => job.category === 'web3').length,
  }), []);

  const changeFilter = (category, checked) => {
    setFilters((current) => ({ ...current, [category]: checked }));
    if (selectedCompany?.category === category && !checked) setSelectedCompany(null);
  };
  const setHome = (point) => {
    setHomePoint({ lat: point.lat, lng: point.lng, name: point.name || point.community || '自选位置' });
    setPickingHome(false);
    setSelectedCompany(null);
    setSelectedProperty(null);
    setMobilePanelOpen(true);
  };

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobilePanelOpen ? 'is-open' : ''}`}>
        <button className="mobile-handle" aria-label="展开或收起面板" onClick={() => setMobilePanelOpen((open) => !open)}><ChevronDown size={18} /></button>
        <header className="brand-block">
          <div className="brand-mark"><Building2 size={18} /></div>
          <div><h1>沪上前端通勤图</h1><p>岗位样本 × 地铁线网</p></div>
        </header>

        <section className="filter-section">
          <div className="section-heading"><div><span className="eyebrow">岗位筛选</span><h2>{visibleCompanies.reduce((sum, office) => sum + office.jobs.length, 0)} 条岗位 · {visibleCompanies.length} 个办公点</h2></div></div>
          <div className="filters">
            <FilterToggle category="ai" checked={filters.ai} onChange={changeFilter} count={counts.ai} />
            <FilterToggle category="web3" checked={filters.web3} onChange={changeFilter} count={counts.web3} />
          </div>
        </section>

        <section className="home-section">
          <div className="section-heading"><div><span className="eyebrow">通勤试算</span><h2>从哪里出发？</h2></div></div>
          <div className="preset-grid">
            {homePresets.map((preset) => (
              <button key={preset.name} className={homePoint?.name === preset.name ? 'is-active' : ''} onClick={() => setHome(preset)}>{preset.name}</button>
            ))}
          </div>
          <button className={`pick-button ${pickingHome ? 'is-active' : ''}`} onClick={() => setPickingHome((active) => !active)}>
            <Crosshair size={16} />{pickingHome ? '请在地图上点选位置' : '在地图上自选位置'}
          </button>
        </section>

        {selectedCompany ? (
          <CompanyDetail company={selectedCompany} jobs={selectedJobs} commute={selectedCommute} onClose={() => setSelectedCompany(null)} />
        ) : selectedProperty ? (
          <PropertyDetail property={selectedProperty} onClose={() => setSelectedProperty(null)} onUseAsHome={setHome} />
        ) : homePoint ? (
          <HomeSummary point={homePoint} results={commuteResults} onClear={() => setHomePoint(null)} onSelectCompany={setSelectedCompany} />
        ) : (
          <section className="empty-state"><Home size={20} /><p>选择一个候选居住区，查看到各办公点的地铁通勤估算。</p></section>
        )}

        <footer className="data-note">100 条招聘记录与 {properties.length} 条 140 万内房源样本，更新于 2026-09-02。房源以太平洋房屋公开详情为主，并补充贝壳、我爱我家样本；挂牌声明和平台核验编码不替代签约前产调。</footer>
      </aside>

      <section className="map-stage">
        <MapCanvas
          visibleCompanies={visibleCompanies}
          showBasemap={showBasemap}
          showMetro={showMetro}
          showStations={showStations}
          showProperties={showProperties}
          showCompanies={showCompanies}
          visibleRings={visibleRings}
          selectedCompany={selectedCompany}
          selectedProperty={selectedProperty}
          onSelectCompany={(company) => { setSelectedCompany(company); setSelectedProperty(null); setMobilePanelOpen(true); }}
          onSelectProperty={(property) => { setSelectedProperty(property); setSelectedCompany(null); setMobilePanelOpen(true); }}
          homePoint={homePoint}
          onSetHome={setHome}
          pickingHome={pickingHome}
        />
        <div className="map-toolbar" aria-label="地图图层">
          <span><Layers3 size={15} />图层</span>
          <label><input type="checkbox" checked={showBasemap} onChange={(event) => setShowBasemap(event.target.checked)} />底图</label>
          <label><input type="checkbox" checked={showMetro} onChange={(event) => setShowMetro(event.target.checked)} />地铁线</label>
          <label><input type="checkbox" checked={showStations} onChange={(event) => setShowStations(event.target.checked)} />站点</label>
          <label><input type="checkbox" checked={showCompanies} onChange={(event) => {
            setShowCompanies(event.target.checked);
            if (!event.target.checked) setSelectedCompany(null);
          }} />公司 {visibleCompanies.length}</label>
          <label><input type="checkbox" checked={showProperties} onChange={(event) => {
            setShowProperties(event.target.checked);
            if (!event.target.checked) setSelectedProperty(null);
          }} />房源 {properties.length}</label>
          <div className="ring-layer-controls" role="group" aria-label="环线范围图层">
            {rings.map((ring) => (
              <label key={ring.id} title={`${ring.name}以内（道路简化范围）`} style={{ '--ring-color': ring.color }}>
                <input type="checkbox" checked={visibleRings[ring.id]} onChange={(event) => {
                  const checked = event.target.checked;
                  setVisibleRings((current) => ({ ...current, [ring.id]: checked }));
                }} />
                <i className="ring-swatch" aria-hidden="true" />{ring.name}
              </label>
            ))}
          </div>
        </div>
        <div className="map-legend">
          <span><i className="legend-company" />公司</span>
          <span><i className="legend-property" />房源</span>
          <span><i className="legend-home" />居住点</span>
          <span><i className="legend-metro" />地铁</span>
        </div>
        {pickingHome && <div className="pick-hint"><LocateFixed size={16} />点击地图设置候选居住点</div>}
        <button className="mobile-panel-toggle" onClick={() => setMobilePanelOpen(true)}><BriefcaseBusiness size={17} />筛选与通勤</button>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
