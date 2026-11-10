// Command evals прогоняет eval-набор против LLM из окружения (LLM_*) и пишет отчёт.
// Без ключа используется mock — так проверяется сам набор и стенд.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"ai-buddy/agent/internal/config"
	"ai-buddy/agent/internal/evals"
	"ai-buddy/agent/internal/llm"
)

func main() {
	casesPath := flag.String("cases", "../evals/cases.json", "файл с кейсами")
	reportPath := flag.String("report", "", "куда записать отчёт (Markdown)")
	flag.Parse()

	cfg := config.Load(nil)
	var client llm.Client = &llm.Mock{}
	model := ""
	if cfg.LLMProvider != "mock" {
		client = llm.NewOpenAI(cfg.LLMBaseURL, cfg.LLMModel, cfg.LLMAPIKey, 45*time.Second)
		model = cfg.LLMModel
	}
	cases, err := evals.Load(*casesPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "не удалось прочитать кейсы:", err)
		os.Exit(2)
	}
	fmt.Printf("Прогон %d кейсов, LLM: %s %s\n", len(cases), client.Name(), model)
	results := evals.Run(context.Background(), client, cases)
	for _, r := range results {
		mark := "PASS"
		if !r.Passed {
			mark = "FAIL"
		}
		fmt.Printf("%s  %-22s %5dms  %v\n", mark, r.Case.ID, r.Duration.Milliseconds(), r.Failures)
	}
	passed, total := evals.Summary(results)
	fmt.Printf("\nПройдено %d из %d (%.0f%%)\n", passed, total, float64(passed)*100/float64(max(total, 1)))
	if *reportPath != "" {
		report := evals.Report(results, client.Name(), model, time.Now())
		if err := os.WriteFile(*reportPath, []byte(report), 0o644); err != nil {
			fmt.Fprintln(os.Stderr, "не удалось записать отчёт:", err)
			os.Exit(2)
		}
		fmt.Println("Отчёт:", *reportPath)
	}
	if passed != total && client.Name() == "mock" {
		os.Exit(1) // mock обязан проходить набор полностью
	}
}
