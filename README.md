# LinkedIn SSI Lab — Personal

Aplicação pessoal para estimar os quatro pilares do SSI, acompanhar um score próprio e reduzir ao mínimo a entrada manual de métricas.

## Fontes automáticas

1. **Link público do perfil**: via API externa configurada no servidor, lê apenas dados públicos do perfil e posts recentes. Preenche foto, capa, seguidores, conexões, recomendações, grupos/interesses, engajamento recebido e taxa média de engajamento.
2. **ZIP oficial do LinkedIn**: processado no navegador. O app deriva recomendações, grupos, dias ativos, comentários/reações feitos, mensagens enviadas, taxa de resposta e alguns sinais da rede quando os CSVs correspondentes existirem.
3. **Campos restantes**: ficam vazios quando a fonte não possui o dado. Não são tratados como zero.

O SSI calculado é uma **estimativa independente**, não o SSI oficial do LinkedIn.

## Privacidade

O ZIP nunca sai do navegador. O link público é enviado apenas ao endpoint `/api/profile-intelligence`, que consulta a fonte pública configurada no servidor. Nenhuma senha, cookie ou sessão do LinkedIn é solicitada. O histórico de medições permanece no `localStorage` do navegador.

## API externa

A análise por link usa Apify e exige a variável de ambiente `APIFY_TOKEN` na Vercel. O token deve ser configurado diretamente no painel da Vercel e nunca commitado no GitHub.

A implementação atual consulta:

- `linkedintel-core/linkedin-profile-scraper-no-cookies` para perfil, recomendações e interesses;
- `harvestapi/linkedin-profile-posts` para posts e métricas públicas de engajamento.

## Desenvolvimento

```sh
npm test
npm run build
```

## Metodologia

Versão `0.3.0`. A régua mantém os quatro pilares de 25 pontos do SSI estimado e cinco dimensões do score próprio. Cada sinal registra sua disponibilidade e a nota final acompanha uma medida de confiança.

## Limitações

Métricas privadas do Sales Navigator, como leads salvos e perfis de prospects visualizados, não podem ser obtidas por um scraper público sem autenticação. A API oficial do Sales Navigator exige acesso de parceiro aprovado. Visualizações recebidas no perfil e search appearances também têm APIs oficiais próprias, mas dependem de permissões aprovadas pelo LinkedIn.
