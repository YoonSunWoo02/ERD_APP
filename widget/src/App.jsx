import { useState, useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  useNodesState,
  useEdgesState,
  Handle,
  Position
} from 'reactflow';
import 'reactflow/dist/style.css';

// 테이블 카드 컴포넌트 — 선이 카드 가장자리에서 연결되도록 Handle 추가
function TableNode({ data }) {
  return (
    <div style={{
      position: 'relative',
      background: '#1e429f',
      color: 'white',
      borderRadius: 10,
      padding: 14,
      minWidth: 220,
      boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
    }}>
      <Handle type="target" position={Position.Left} id="left" style={{ width: 10, height: 10, background: '#1a56db', border: '2px solid white' }} />
      <Handle type="source" position={Position.Right} id="right" style={{ width: 10, height: 10, background: '#1a56db', border: '2px solid white' }} />
      <Handle type="target" position={Position.Top} id="top" style={{ width: 10, height: 10, background: '#1a56db', border: '2px solid white' }} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ width: 10, height: 10, background: '#1a56db', border: '2px solid white' }} />
      <div style={{
        fontWeight: 'bold',
        fontSize: 16,
        marginBottom: 10,
        borderBottom: '1px solid rgba(255,255,255,0.3)',
        paddingBottom: 8
      }}>
        📋 {data.label}
      </div>
      {data.columns?.map(col => {
        const isPK = col.primaryKey === true || col.isPrimary === true;
        const isFK = col.foreignKey === true || col.isForeign === true;
        return (
          <div key={col.name} style={{
            background: isPK
              ? 'rgba(251,191,36,0.9)'
              : 'rgba(255,255,255,0.12)',
            color: isPK ? '#1a1a1a' : 'white',
            borderRadius: 5,
            padding: '5px 10px',
            marginBottom: 4,
            fontSize: 13,
            display: 'flex',
            justifyContent: 'space-between'
          }}>
            <span>
              {isPK ? '🔑' : isFK ? '🔗' : '　'}
              {' '}{col.name}
            </span>
            <span style={{ opacity: 0.7, fontSize: 11 }}>{col.type}</span>
          </div>
        );
      })}
    </div>
  );
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const nodeTypes = { tableNode: TableNode };

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [erdData, setErdData] = useState(null);
  const [copied, setCopied] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [sharing, setSharing] = useState(false);

  // ChatGPT에서 ERD 데이터 수신
  useEffect(() => {
    const handler = (event) => {
      if (event.data?.type === 'erd_data') {
        buildGraph(event.data.payload);
        setErdData(event.data.payload);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // 공유 링크 /share/:id 로 진입 시 ERD 로드
  useEffect(() => {
    const match = window.location.pathname.match(/^\/share\/([a-f0-9]+)$/i);
    if (!match) return;
    const shareId = match[1];
    fetch(`${API_URL}/api/share/${shareId}`)
      .then(res => res.ok ? res.json() : Promise.reject(res))
      .then(({ data }) => {
        if (data?.tables) {
          buildGraph(data);
          setErdData(data);
        }
      })
      .catch(() => {});
  }, []);

  function buildGraph(data) {
    const cols = 3;
    const tables = data.tables || [];
    // 노드 id: table.id 있으면 사용 (relationships의 source/target과 맞춤), 없으면 table.name
    const newNodes = tables.map((table, i) => ({
      id: table.id || table.name,
      type: 'tableNode',
      position: {
        x: (i % cols) * 300,
        y: Math.floor(i / cols) * 280
      },
      data: { label: table.name || table.id, columns: table.columns }
    }));

    // relations(from, to) 또는 relationships(source, target) 둘 다 지원
    const relationsList = data.relations || (data.relationships || []).map((r) => ({
      from: r.source,
      to: r.target,
      type: r.type || r.label || '1:N'
    }));

    const newEdges = relationsList.map((rel, i) => ({
      id: `e${i}`,
      source: rel.from,
      target: rel.to,
      sourceHandle: 'right',
      targetHandle: 'left',
      label: rel.type || '1:N',
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#1a56db' },
      style: { stroke: '#1a56db', strokeWidth: 2 },
      labelStyle: { fill: '#1e429f', fontWeight: 'bold', fontSize: 12 },
      labelBgStyle: { fill: 'white', fillOpacity: 0.9 },
      labelBgPadding: [6, 4],
      labelBgBorderRadius: 4
    }));

    setNodes(newNodes);
    setEdges(newEdges);
  }

  async function loadFromJson() {
    setPasteError('');
    try {
      const data = JSON.parse(pasteText);
      if (!data.tables || !Array.isArray(data.tables)) {
        setPasteError('올바른 ERD JSON이 아닙니다. tables 배열이 필요해요.');
        return;
      }
      const res = await fetch(`${API_URL}/api/usage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) {
        setPasteError('서버 연결을 확인해주세요.');
        return;
      }
      buildGraph(data);
      setErdData(data);
      setPasteOpen(false);
      setPasteText('');
      console.log('[ERD] JSON 적용 완료');
    } catch (e) {
      console.error('[ERD] JSON 적용 실패:', e);
      setPasteError('JSON 형식이 잘못됐어요. ' + (e.message || ''));
    }
  }

  async function shareERD() {
    if (!erdData) return;
    setSharing(true);
    try {
      const res = await fetch(`${API_URL}/api/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ erdData })
      });
      let data = {};
      try {
        const text = await res.text();
        if (text) data = JSON.parse(text);
      } catch (_) {}
      if (!res.ok) throw new Error(data.error || data.message || '공유 실패');
      const shareUrl = data.shareUrl || `${window.location.origin}/share/${data.shareId}`;
      await navigator.clipboard.writeText(shareUrl);
      alert('공유 링크가 클립보드에 복사됐어요! 🔗');
    } catch (e) {
      alert('공유 실패: 서버를 확인해주세요. (API 서버: npm run api)');
    }
    setSharing(false);
  }

  function exportDDL() {
    if (!erdData) return;
    const ddl = erdData.tables.map(t => {
      const cols = t.columns.map(c => {
        let def = `  ${c.name} ${c.type}`;
        if (c.primaryKey) def += ' PRIMARY KEY';
        if (!c.nullable) def += ' NOT NULL';
        return def;
      }).join(',\n');
      return `CREATE TABLE ${t.name} (\n${cols}\n);`;
    }).join('\n\n');
    navigator.clipboard.writeText(ddl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{ height: '100vh', fontFamily: 'Arial, sans-serif', display: 'flex', flexDirection: 'column' }}>
      {/* 헤더 */}
      <div style={{
        padding: '10px 20px',
        background: '#1a56db',
        color: 'white',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <span style={{ fontWeight: 'bold', fontSize: 16 }}>🗄️ ERD 뷰어</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {erdData && (
            <span style={{ fontSize: 13, opacity: 0.8 }}>
              테이블 {erdData.tables.length}개
            </span>
          )}
          <button
            onClick={() => setPasteOpen(true)}
            style={{
              background: 'white',
              color: '#1a56db',
              border: 'none',
              borderRadius: 6,
              padding: '6px 14px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: 13
            }}
          >
            📥 JSON 붙여넣기
          </button>
          <button
            onClick={shareERD}
            disabled={!erdData || sharing}
            style={{
              background: 'rgba(255,255,255,0.2)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.4)',
              borderRadius: 6,
              padding: '6px 14px',
              cursor: erdData ? 'pointer' : 'not-allowed',
              fontWeight: 'bold',
              fontSize: 13
            }}
          >
            {sharing ? '생성 중...' : '🔗 공유'}
          </button>
          <button
            onClick={exportDDL}
            disabled={!erdData}
            style={{
              background: copied ? '#166534' : 'white',
              color: copied ? 'white' : '#1a56db',
              border: 'none',
              borderRadius: 6,
              padding: '6px 14px',
              cursor: erdData ? 'pointer' : 'not-allowed',
              fontWeight: 'bold',
              fontSize: 13,
              transition: 'all 0.2s'
            }}
          >
            {copied ? '✅ 복사됨!' : '📋 DDL 복사'}
          </button>
        </div>
      </div>

      {/* JSON 붙여넣기 모달 */}
      {pasteOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }} onClick={() => { setPasteOpen(false); setPasteError(''); }}>
          <div style={{
            background: 'white',
            borderRadius: 12,
            padding: 20,
            maxWidth: 520,
            width: '90%',
            maxHeight: '80vh',
            overflow: 'auto',
            boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 'bold', marginBottom: 8 }}>ERD JSON 붙여넣기</div>
            <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 10 }}>
              Cursor에서 받은 ERD JSON을 붙여넣고 적용을 누르세요.
            </div>
            <textarea
              value={pasteText}
              onChange={e => { setPasteText(e.target.value); setPasteError(''); }}
              placeholder='{"tables": [...], "relations": [...]}'
              style={{
                width: '100%',
                minHeight: 180,
                padding: 12,
                borderRadius: 8,
                border: '1px solid #E5E7EB',
                fontFamily: 'monospace',
                fontSize: 12
              }}
            />
            {pasteError && (
              <div style={{ color: '#DC2626', fontSize: 13, marginTop: 8 }}>{pasteError}</div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setPasteOpen(false); setPasteError(''); setPasteText(''); }}
                style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #D1D5DB', background: 'white', cursor: 'pointer' }}
              >
                취소
              </button>
              <button
                onClick={loadFromJson}
                style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#1a56db', color: 'white', cursor: 'pointer', fontWeight: 'bold' }}
              >
                적용
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ERD 캔버스 */}
      {nodes.length === 0 ? (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#9CA3AF',
          gap: 12
        }}>
          <div style={{ fontSize: 48 }}>🗄️</div>
          <div style={{ fontSize: 16, fontWeight: 'bold' }}>ERD 뷰어 준비 완료</div>
          <div style={{ fontSize: 14 }}>Cursor 채팅에서 ERD를 요청한 뒤, 받은 JSON을 붙여넣어 보세요</div>
          <div style={{ fontSize: 13, color: '#D1D5DB', maxWidth: 340, textAlign: 'center' }}>
            예: "쇼핑몰 DB ERD 만들어줘 — 회원, 상품, 주문, 주문상세 포함"
          </div>
          <button
            onClick={() => setPasteOpen(true)}
            style={{
              marginTop: 8,
              padding: '10px 20px',
              borderRadius: 8,
              border: 'none',
              background: '#1a56db',
              color: 'white',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: 14
            }}
          >
            📥 JSON 붙여넣기
          </button>
        </div>
      ) : (
        <div style={{ flex: 1 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
          >
            <Background color="#E5E7EB" gap={20} />
            <Controls />
          </ReactFlow>
        </div>
      )}
    </div>
  );
}
