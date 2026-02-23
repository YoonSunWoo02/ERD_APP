const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { OpenAI } = require('openai');
const z = require('zod');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const mcpServer = new McpServer(
  { name: 'erd-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// 도구: 자연어 → ERD JSON
mcpServer.tool(
  'generate_erd',
  '자연어 설명으로 ERD JSON을 생성합니다',
  { description: z.string().describe('DB 구조 설명') },
  async ({ description }) => {
    const prompt = `
다음 설명을 바탕으로 데이터베이스 ERD JSON을 생성해줘.
반드시 아래 형식의 JSON만 출력하고 다른 텍스트는 절대 쓰지 마.

형식:
{
  "tables": [
    {
      "name": "테이블명",
      "columns": [
        { "name": "컬럼명", "type": "VARCHAR(50)", "primaryKey": true, "foreignKey": false, "nullable": false }
      ]
    }
  ],
  "relations": [
    { "from": "테이블A", "to": "테이블B", "type": "1:N" }
  ]
}

설명: ${description}
`;
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });
    const erdJson = response.choices[0].message.content;
    return { content: [{ type: 'text', text: erdJson }] };
  }
);

// 도구: SQL → ERD JSON
mcpServer.tool(
  'sql_to_erd',
  'SQL CREATE TABLE 문을 ERD로 변환합니다',
  { sql: z.string().describe('SQL DDL 코드') },
  async ({ sql }) => {
    const prompt = `
다음 SQL을 분석해서 위와 동일한 ERD JSON 형식으로 변환해줘.
JSON만 출력하고 다른 텍스트는 절대 쓰지 마.
형식: { "tables": [ { "name": "테이블명", "columns": [ { "name", "type", "primaryKey", "foreignKey", "nullable" } ] } ], "relations": [ { "from", "to", "type": "1:N" } ] }

SQL: ${sql}
`;
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });
    const erdJson = response.choices[0].message.content;
    return { content: [{ type: 'text', text: erdJson }] };
  }
);

// 도구: 정규화 분석
mcpServer.tool(
  'analyze_normalization',
  '현재 ERD의 정규화 상태를 분석하고 개선점을 제안합니다',
  { erdJson: z.string().describe('분석할 ERD JSON 문자열') },
  async ({ erdJson }) => {
    const prompt = `
다음 ERD JSON을 분석해서 데이터베이스 정규화 관점에서 피드백을 줘.
1NF, 2NF, 3NF 기준으로 문제점과 개선 방법을 한국어로 설명해줘.
형식: { "score": 85, "issues": ["문제1", "문제2"], "suggestions": ["개선안1", "개선안2"] }

ERD: ${erdJson}
`;
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    });
    const analysis = response.choices[0].message.content;
    return { content: [{ type: 'text', text: analysis }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

main().catch((err) => {
  console.error('erd-server error:', err);
  process.exit(1);
});
