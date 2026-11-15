'use client'; 

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';

const TARGETS = [
  { name: "Barnard's Star", ra: "269.452", dec: "4.693", desc: "High proper motion star" },
  { name: "WISE 0855", ra: "133.795", dec: "-7.245", desc: "Fast-moving brown dwarf" },
  { name: "M31 (Andromeda)", ra: "10.684", dec: "41.269", desc: "Spiral Galaxy" },
  { name: "M42 (Orion Nebula)", ra: "83.822", dec: "-5.391", desc: "Stellar Nursery" },
  { name: "Pleiades (M45)", ra: "56.75", dec: "24.116", desc: "Star Cluster" },
  { name: "Sirius", ra: "101.287", dec: "-16.716", desc: "Brightest Star" },
];

const InfoTip = ({ text }) => (
  <div className="group relative inline-block ml-2 cursor-help z-50">
    <div className="w-4 h-4 rounded-full bg-gray-600 text-gray-200 text-[10px] font-bold flex items-center justify-center hover:bg-gray-500">i</div>
    <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 w-48 p-2 bg-gray-900 border border-gray-600 text-white text-xs rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 text-center">
      {text}
    </div>
  </div>
);

export default function Home() {
  const [supabase, setSupabase] = useState(null);
  const [user, setUser] = useState(null);
  const [posts, setPosts] = useState([]);
  
  const [ra, setRa] = useState('304.693508808');
  const [dec, setDec] = useState('42.4436872991');
  const [fov, setFov] = useState('0.1');
  const [startDate, setStartDate] = useState('');
  const [band, setBand] = useState('');
  const [maxFrames, setMaxFrames] = useState(4); 
  
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [progress, setProgress] = useState(0);
  const [totalProgress, setTotalProgress] = useState(1);
  const [frames, setFrames] = useState([]); 
  const [notices, setNotices] = useState([]);
  const [errorMsg, setErrorMsg] = useState(null); 
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [offset, setOffset] = useState(0);
  const [totalAvailable, setTotalAvailable] = useState(0);

  const [diffImage, setDiffImage] = useState(null);
  const [diffContrast, setDiffContrast] = useState(1.0); 
  const [diffInfo, setDiffInfo] = useState({ f1: 0, f2: 0 });
  const [fps, setFps] = useState(2);

  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [showAiOverlay, setShowAiOverlay] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [note, setNote] = useState('');
  const [shareError, setShareError] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyContent, setReplyContent] = useState('');

  useEffect(() => {
    const client = createClient();
    setSupabase(client);

    const handleAuthCallback = async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');
      if (code) {
        const { data, error } = await client.auth.exchangeCodeForSession(code);
        if (!error && data.session) {
          window.history.replaceState({}, document.title, window.location.pathname);
          setUser(data.session.user);
        }
      } else {
        client.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
      }
    };
    handleAuthCallback();

    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  const fetchPosts = async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from('posts').select(`*, profiles (full_name, avatar_url), replies (*, profiles (full_name))`).order('created_at', { ascending: false }).limit(20);
    if (!error && data) setPosts(data);
  };

  useEffect(() => { if (supabase) fetchPosts(); }, [supabase]);

  const handleSearch = async (e, newOffset = 0) => {
    if (e) e.preventDefault();
    setLoading(true); setFrames([]); setNotices([]); setDiffImage(null); setErrorMsg(null);
    setStatusText('Starting job...'); setProgress(0); 
    
    const framesToFetch = Math.max(2, parseInt(maxFrames) || 2);
    setTotalProgress(framesToFetch);
    
    setIsPlaying(false); setCurrentIndex(0); setOffset(newOffset); setAiAnalysis(null); setShowAiOverlay(false);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const query = new URLSearchParams({ 
        ra, dec, fov, start_date: startDate, end_date: '', band, 
        max_frames: framesToFetch, fps, offset: newOffset 
      }).toString();
      
      const response = await fetch(`/api/image?${query}`, { 
        method: 'POST',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
         throw new Error("Failed to connect to backend.");
      }
      
      const { task_id } = await response.json();
      let isDone = false, attempts = 0;
      
      while (!isDone && attempts < 60) {
        await new Promise(r => setTimeout(r, 1000));
        attempts++;
        const statusRes = await fetch(`/api/status/${task_id}`);
        if (!statusRes.ok) throw new Error("Lost connection to backend.");
        const statusData = await statusRes.json();
        if (statusData.progress !== undefined) setProgress(statusData.progress);
        if (statusData.total !== undefined) setTotalProgress(statusData.total);
        if (statusData.status === "error") throw new Error(statusData.msg || "Backend error.");
        if (statusData.status === "complete") isDone = true;
        else setStatusText(statusData.status);
      }
      if (!isDone) throw new Error("Request timed out.");
      const imgRes = await fetch(`/api/result/${task_id}`);
      const data = await imgRes.json();
      setFrames(data.frames);
      setNotices(data.notices || []);
      setTotalAvailable(data.total_available || 0);
      setStatusText('');
    } catch (err) {
      setErrorMsg(err.message);
      setStatusText('');
    } finally { setLoading(false); }
  };

  const handleAiAnalyze = async () => {
    if (frames.length === 0) return;
    setAiLoading(true);
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: frames[currentIndex].url })
      });
      const data = await response.json();
      if (data.summary) {
        setAiAnalysis(data);
        setShowAiOverlay(true);
      } else {
        alert(data.error || "AI failed to analyze.");
      }
    } catch (err) {
      alert("Network error analyzing image.");
    } finally { setAiLoading(false); }
  };

  const handleLogin = async () => {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } });
  };

  const handleLogout = async () => { if (supabase) await supabase.auth.signOut(); };

  const submitPost = async () => {
    if (!note || !user || !supabase) return;
    setShareError(null);
    try {
      const { error } = await supabase.from('posts').insert({
        user_id: user.id, ra: parseFloat(ra), dec: parseFloat(dec), note: note,
        image_url: diffImage || (frames.length > 0 ? frames[currentIndex].url : null)
      });
      if (error) throw error;
      setShowModal(false); setNote(''); fetchPosts();
    } catch (e) { setShareError(e.message); }
  };

  const handleLike = async (postId, currentLikes) => {
    if (!user || !supabase) return alert("Please log in to like posts.");
    await supabase.from('posts').update({ likes: currentLikes + 1 }).eq('id', postId);
    fetchPosts();
  };

  const submitReply = async (postId) => {
    if (!replyContent || !user || !supabase) return;
    await supabase.from('replies').insert({ post_id: postId, user_id: user.id, content: replyContent });
    setReplyingTo(null); setReplyContent(''); fetchPosts();
  };

  const handleBlink = () => { setIsPlaying(false); setDiffImage(null); setShowAiOverlay(false); setCurrentIndex((prev) => (prev === 0 ? frames.length - 1 : 0)); };

  const handleSubtract = (contrastValue = diffContrast) => {
    if (frames.length < 2) return;
    setIsPlaying(false);
    const img1 = new Image(), img2 = new Image();
    const f1 = 0, f2 = frames.length - 1;
    img1.src = frames[f1].url; img2.src = frames[f2].url;
    Promise.all([new Promise(r => img1.onload = r), new Promise(r => img2.onload = r)]).then(() => {
      const canvas = document.createElement('canvas');
      canvas.width = img1.width; canvas.height = img1.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img1, 0, 0);
      const data1 = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      ctx.drawImage(img2, 0, 0);
      const data2 = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const diffData = ctx.createImageData(canvas.width, canvas.height);
      for (let i = 0; i < data1.length; i += 4) {
        let diffVal = Math.min(255, Math.abs(data1[i] - data2[i]) * contrastValue);
        diffData.data[i] = diffVal; diffData.data[i+1] = diffVal; diffData.data[i+2] = diffVal < 50 ? diffVal : 50; diffData.data[i+3] = 255;
      }
      ctx.putImageData(diffData, 0, 0);
      setDiffImage(canvas.toDataURL('image/png'));
      setDiffInfo({ f1: f1 + 1, f2: f2 + 1 });
    });
  };

  const openAladin = () => { window.open(`https://aladin.cds.unistra.fr/AladinLite/?target=${ra}%20${dec}&fov=0.1&survey=CDS%2FP%2FDSS2%2Fcolor`, '_blank'); };

  const progressPercent = totalProgress > 0 ? Math.round((progress / totalProgress) * 100) : 0;
  const isSearching = statusText.toLowerCase().includes('searching') || statusText.toLowerCase().includes('contacting');

  return (
    <main className="min-h-screen bg-gray-900 text-white font-sans flex flex-col h-screen">
      
      {/* HEADER WITH BRANDING */}
      <header className="bg-gray-950 p-4 border-b border-gray-700 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-4">
          <img src="/logo.png" alt="Paradigm Shifters" className="w-12 h-12 object-contain rounded-full shadow-lg shadow-blue-500/20" />
          <div>
            <h1 className="text-2xl font-bold text-blue-400 tracking-wider">SPHEREx Sky Viewer</h1>
            <p className="text-xs text-gray-400 font-semibold tracking-widest uppercase">PARADIGM SHIFTERS</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <p className="text-[10px] text-gray-500">Researcher & Site Builder: <span className="text-gray-300 font-bold">Shanthosh R.</span></p>
          {user ? (
            <div className="flex items-center gap-3 bg-gray-800 px-3 py-1 rounded-full border border-gray-600">
              <img src={user.user_metadata?.avatar_url || 'https://via.placeholder.com/30'} alt="Profile" className="w-8 h-8 rounded-full" />
              <span className="text-sm font-bold">{user.user_metadata?.full_name || 'User'}</span>
              <button onClick={handleLogout} className="text-xs text-red-400 hover:text-red-300 ml-2">Logout</button>
            </div>
          ) : (
            <button onClick={handleLogin} className="bg-white text-gray-900 font-bold py-2 px-4 rounded hover:bg-gray-200 transition-colors flex items-center gap-2">Sign in with Google</button>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-80 bg-gray-800 border-r border-gray-700 p-6 overflow-y-auto space-y-6 shrink-0">
          <div>
            <label className="text-xs font-bold text-blue-300 uppercase tracking-widest mb-2 flex items-center">
              Target Catalog <InfoTip text="Select famous objects or type custom coordinates." />
            </label>
            <select onChange={(e) => { const t = TARGETS[e.target.value]; if (t) { setRa(t.ra); setDec(t.dec); } }} className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-sm focus:border-blue-500 outline-none">
              <option value="">Custom Coordinates...</option>
              {TARGETS.map((t, i) => <option key={i} value={i}>{t.name} ({t.desc})</option>)}
            </select>
          </div>
          <div className="space-y-3">
            <div><label className="text-xs text-gray-400 mb-1 block">Right Ascension (deg)</label><input type="text" value={ra} onChange={(e) => setRa(e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-sm" /></div>
            <div><label className="text-xs text-gray-400 mb-1 block">Declination (deg)</label><input type="text" value={dec} onChange={(e) => setDec(e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-sm" /></div>
            <div><label className="text-xs text-gray-400 mb-1 block">Field of View (deg)</label><input type="number" step="0.01" value={fov} onChange={(e) => setFov(e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-sm" /></div>
          </div>
          <hr className="border-gray-700" />
          <div>
            <label className="text-xs font-bold text-blue-300 uppercase tracking-widest mb-2 flex items-center">
              Data Filters <InfoTip text="Optional: Filter by specific observation dates or detector bands." />
            </label>
            <div className="space-y-3">
              <div><label className="text-xs text-gray-400 mb-1 block">Date (e.g., 2026W20)</label><input type="text" value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="YYYYWW" className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-sm" /></div>
              <div><label className="text-xs text-gray-400 mb-1 block">Band (e.g., 2A, 4D3)</label><input type="text" value={band} onChange={(e) => setBand(e.target.value)} placeholder="Filter by Band" className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-sm" /></div>
              <div><label className="text-xs text-gray-400 mb-1 block">Frames per page (2-10)</label><input type="number" min="2" max="10" value={maxFrames} onChange={(e) => setMaxFrames(e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-sm" /></div>
            </div>
          </div>
          <button onClick={handleSearch} disabled={loading} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded mt-4 transition-colors">{loading ? 'Processing...' : 'Fetch Data'}</button>
        </aside>

        <section className="flex-1 bg-black flex flex-col items-center justify-center relative p-8">
          
          {errorMsg && !loading && frames.length === 0 && (
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-red-900/90 text-red-200 px-8 py-6 rounded-lg border border-red-700 text-center z-50 shadow-2xl max-w-lg">
              <p className="font-bold text-xl mb-2">⚠️ Connection Error</p>
              <p>{errorMsg}</p>
              <button onClick={() => setErrorMsg(null)} className="mt-4 bg-red-700 hover:bg-red-600 px-4 py-2 rounded font-bold">Dismiss</button>
            </div>
          )}

          {loading && (
             <div className="text-center z-10 bg-gray-900/90 p-8 rounded-lg border border-gray-700 w-96 shadow-2xl">
               <p className="text-blue-400 text-lg font-bold mb-4">{statusText}</p>
               <div className="w-full bg-gray-700 rounded-full h-4 mb-2 overflow-hidden">
                 <div className={`h-4 rounded-full transition-all duration-300 ${isSearching ? 'bg-indigo-500 animate-pulse w-full' : 'bg-blue-500'}`} style={{ width: isSearching ? '100%' : `${progressPercent}%` }}></div>
               </div>
               {!isSearching && <div className="flex justify-between text-xs text-gray-400 mt-1"><span>Frame {progress} of {totalProgress}</span><span>{progressPercent}%</span></div>}
             </div>
          )}
          {!loading && frames.length > 0 && (
            <div className="flex flex-col items-center w-full max-w-2xl">
              {notices.length > 0 && (
                <div className="w-full mb-4 space-y-2">
                  {notices.map((notice, idx) => <div key={idx} className="bg-yellow-900/50 border border-yellow-600 text-yellow-200 px-4 py-2 rounded text-sm flex items-start"><span className="mr-2">ℹ️</span> {notice}</div>)}
                </div>
              )}
              
              <div className="w-full aspect-square bg-gray-900 rounded-lg overflow-hidden border border-gray-700 shadow-2xl relative">
                <img src={diffImage ? diffImage : frames[currentIndex].url} alt="Viewer" className="w-full h-full object-contain" />
                
                {/* AI BOUNDING BOXES ONLY */}
                {showAiOverlay && aiAnalysis && (
                  <div className="absolute inset-0 pointer-events-none z-10">
                    {aiAnalysis.objects && aiAnalysis.objects.map((obj, idx) => (
                      <div key={idx} 
                        className="absolute border-2 border-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.5)]"
                        style={{
                          top: `${obj.box[0]}%`, left: `${obj.box[1]}%`, 
                          height: `${obj.box[2] - obj.box[0]}%`, width: `${obj.box[3] - obj.box[1]}%`
                        }}
                      >
                        <span className="absolute -top-6 left-0 bg-yellow-500 text-black text-[10px] font-bold px-1 rounded shadow">
                          {obj.label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="absolute bottom-0 left-0 right-0 bg-black/70 p-2 text-xs font-mono text-gray-300 flex justify-between z-20">
                  {diffImage ? <span className="text-green-400 font-bold">Difference: {diffInfo.f1} vs {diffInfo.f2}</span> : <span>Frame {currentIndex + 1}/{frames.length}</span>}
                  <span className="truncate max-w-xs">{diffImage ? "Subtracted Image" : frames[currentIndex].name}</span>
                </div>
              </div>

              <div className="w-full mt-6 flex items-center space-x-4">
                <input type="range" min="0" max={frames.length - 1} value={currentIndex} onChange={(e) => { setIsPlaying(false); setDiffImage(null); setShowAiOverlay(false); setCurrentIndex(parseInt(e.target.value)); }} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer" />
              </div>
            </div>
          )}
          {!loading && frames.length === 0 && !errorMsg && <div className="text-gray-600 flex flex-col items-center"><p className="text-lg">Select a target and fetch data to begin.</p></div>}
        </section>

        <aside className="w-96 bg-gray-800 border-l border-gray-700 flex flex-col shrink-0">
          <div className="p-6 border-b border-gray-700">
            <h3 className="text-xs font-bold text-blue-300 uppercase tracking-widest mb-4">Playback Controls</h3>
            <div className="space-y-4">
              <div className="flex space-x-2">
                <button onClick={() => { setDiffImage(null); setShowAiOverlay(false); setIsPlaying(!isPlaying); }} disabled={frames.length === 0} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 py-2 rounded text-sm font-bold flex items-center justify-center gap-2">
                  {isPlaying ? '⏸ Pause' : '▶ Play'}
                  {isPlaying && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>}
                </button>
                <button onClick={handleBlink} disabled={frames.length === 0} className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 py-2 rounded text-sm font-bold flex items-center justify-center">
                  Blink <InfoTip text="Flashes between the first and last image." />
                </button>
              </div>

              <button onClick={handleAiAnalyze} disabled={frames.length === 0 || aiLoading} className="w-full bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-700 py-2 rounded text-sm font-bold text-black flex items-center justify-center">
                {aiLoading ? 'Analyzing with AI...' : '✨ AI Analyze Image'} 
                <InfoTip text="Uses Gemini AI to detect objects and draw bounding boxes." />
              </button>

              {/* AI Summary Box Moved Here */}
              {showAiOverlay && aiAnalysis && (
                <div className="bg-black/80 border border-yellow-500 text-yellow-200 p-3 rounded text-sm">
                  <div className="flex justify-between items-center mb-1 border-b border-yellow-500/30 pb-1">
                    <strong className="text-yellow-400">🤖 AI Summary</strong>
                    <button onClick={() => setShowAiOverlay(false)} className="text-red-400 hover:text-red-300 font-bold">✕</button>
                  </div>
                  <p>{aiAnalysis.summary}</p>
                </div>
              )}

              <div className="border border-gray-600 p-3 rounded bg-gray-900">
                <button onClick={() => handleSubtract()} disabled={frames.length < 2} className="w-full bg-green-600 hover:bg-green-500 disabled:bg-gray-700 py-2 rounded text-sm font-bold mb-3 flex items-center justify-center">
                  Subtract First & Last <InfoTip text="Calculates the difference between two images. Highlights moving objects." />
                </button>
                {diffImage && (
                  <div className="mt-2">
                    <label className="text-xs text-gray-400 mb-1 flex justify-between"><span>Amplify Motion</span> <span>{diffContrast}x</span></label>
                    <input type="range" min="1" max="10" step="0.5" value={diffContrast} onChange={(e) => { const val = parseFloat(e.target.value); setDiffContrast(val); handleSubtract(val); }} className="w-full" />
                    <button onClick={() => setDiffImage(null)} className="w-full mt-2 text-xs text-red-400 hover:text-red-300 underline">Clear Subtraction</button>
                  </div>
                )}
              </div>
              
              <button onClick={openAladin} className="w-full bg-indigo-600 hover:bg-indigo-500 py-2 rounded text-sm font-bold flex items-center justify-center">
                Aladin Overlay (Gaia/WISE) <InfoTip text="Opens a professional sky map." />
              </button>

              <div>
                <label className="text-xs text-gray-400 mb-1 flex justify-between"><span>Animation Speed (FPS)</span> <span>{fps}</span></label>
                <input type="range" min="0.5" max="5" step="0.5" value={fps} onChange={(e) => setFps(parseFloat(e.target.value))} className="w-full" />
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 bg-gray-850">
            <h3 className="text-xs font-bold text-blue-300 uppercase tracking-widest mb-4 flex justify-between items-center">
              Community Findings
              {frames.length > 0 && user && <button onClick={() => setShowModal(true)} className="bg-green-500 text-white text-xs px-2 py-1 rounded hover:bg-green-400">+ Share</button>}
            </h3>
            <div className="space-y-3 pb-10">
              {posts.length === 0 && <p className="text-xs text-gray-500 text-center">No findings shared yet.</p>}
              {posts.map(post => (
                <div key={post.id} className="bg-gray-900 p-3 rounded border border-gray-700 text-sm">
                  {post.image_url && <img src={post.image_url} className="w-full h-32 object-cover rounded mb-2" />}
                  <div className="flex items-center gap-2 mb-1">
                    <img src={post.profiles?.avatar_url || 'https://via.placeholder.com/20'} className="w-5 h-5 rounded-full" />
                    <span className="text-xs text-blue-300 font-bold">{post.profiles?.full_name || 'Unknown User'}</span>
                  </div>
                  <div className="text-gray-200 text-xs mb-2">{post.note}</div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg w-96 border border-gray-600">
            <h2 className="text-xl font-bold mb-4">Share Finding</h2>
            {shareError && <div className="text-red-400 text-sm mb-2">{shareError}</div>}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you find?" className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-sm mb-4 h-24" />
            <div className="flex space-x-2">
              <button onClick={() => setShowModal(false)} className="flex-1 bg-gray-600 py-2 rounded">Cancel</button>
              <button onClick={submitPost} className="flex-1 bg-green-600 hover:bg-green-500 py-2 rounded font-bold">Post</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
// FINAL LINE - DO NOT DELETE