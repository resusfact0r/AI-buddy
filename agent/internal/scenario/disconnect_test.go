package scenario

import (
	"bytes"
	"context"
	"net/http"
	"testing"
	"time"

	"ai-buddy/agent/internal/fakeapi"
	"ai-buddy/agent/internal/llm"
)

// blocking — «LLM», который генерирует ответ, пока клиент не отключится.
type blocking struct {
	started chan struct{}
	stopped chan struct{}
}

func (b *blocking) Name() string { return "blocking" }

func (b *blocking) Chat(ctx context.Context, _ llm.Request, onToken func(string)) (llm.Response, error) {
	onToken("Начинаю отвечать ")
	close(b.started)
	<-ctx.Done()
	close(b.stopped)
	return llm.Response{}, ctx.Err()
}

// Обрыв соединения или отмена на фронте останавливает генерацию (docs/agent-api.md).
func TestClientDisconnectStopsGeneration(t *testing.T) {
	b := &blocking{started: make(chan struct{}), stopped: make(chan struct{})}
	e := newEnv(t, b)
	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, e.agent.URL+"/api/v1/agent/chat",
		bytes.NewReader([]byte(`{"message":"расскажи подробно"}`)))
	req.Header.Set("Authorization", "Bearer "+fakeapi.Token(anna))
	go func() {
		resp, err := http.DefaultClient.Do(req)
		if err == nil {
			buf := make([]byte, 1024)
			for {
				if _, err := resp.Body.Read(buf); err != nil {
					break
				}
			}
			resp.Body.Close()
		}
	}()
	select {
	case <-b.started:
	case <-time.After(5 * time.Second):
		t.Fatal("генерация не началась")
	}
	cancel() // пользователь закрыл вкладку / нажал «Стоп»
	select {
	case <-b.stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("генерация не остановилась после отключения клиента")
	}
	// Обработчик завершается сам: дожидаемся, пока он сохранит начатый ответ в историю.
	deadline := time.Now().Add(5 * time.Second)
	for e.api.Hits("POST /chat/messages") < 2 {
		if time.Now().After(deadline) {
			t.Fatal("обработчик не завершился после отключения клиента")
		}
		time.Sleep(10 * time.Millisecond)
	}
}
