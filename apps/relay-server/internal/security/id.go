package security

import (
	"fmt"

	"github.com/google/uuid"
)

func NewID() string {
	return uuid.NewString()
}

func MustNewID() string {
	id, err := uuid.NewRandom()
	if err != nil {
		panic(fmt.Errorf("failed to generate uuid: %w", err))
	}
	return id.String()
}
