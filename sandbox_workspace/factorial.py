def factorial(n):
    if not isinstance(n, int) or n < 0:
        raise ValueError('Input must be a non-negative integer')
    if n == 0:
        return 1
    else:
        return n * factorial(n-1)